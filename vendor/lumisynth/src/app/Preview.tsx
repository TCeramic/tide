// src/app/Preview.tsx
// 预览舞台：内核画在固定的逻辑画幅上（见 OUTPUT_LOGICAL_SIZES），再按容器大小等比缩放显示。
// `?engine=legacy` 时改用路线 A 的两个原版 runtime（渲染基线对照 folia 用）。
import { resolveBackgroundClips } from '@/core/assets/background';
import { ClipHandles } from './ClipHandles';
import { addAssetClip, addBackgroundClip, importLibraryImage, importLibraryVideo, updateAssetClip } from '@/project/assets';
import type { BackgroundClip, BackgroundSource } from '@/core/assets/background';
import { getPreviewKernel } from '@/agent/host';
import type { AssetClip, ClipTiming } from '@/core/assets/clips';
import { resolveAssetClips } from '@/core/assets/clips';
import { normalizeTypography } from '@/project/typography';
import { useReadyTypography } from './fontsReady';
import { setPreviewKernel } from '@/agent/host';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LumiKernel, KernelLook } from '@/kernel/runtime';
import { mountPack, type PackId as LegacyPackId, type PackRuntimeHandle } from '@/host/packRuntime';
import type { SonnetTuning } from '@/packs/sonnet/sonnetTuning';
import type { TemperaTuning } from '@/packs/tempera/temperaTuning';
import { snapResolutionToTexturePool } from '@/engine/shared/pixiTextureBudget';
import { FOLIA_COMPATIBLE_PARAMS } from '@/compiler/params';
import type { StyleId } from '@/compiler/types';
import { lockShotStyle, setShotComponent } from '@/project/edits';
import { activeTheme, packTuningOf, renderFonts } from '@/project/defaults';
import { useSession } from '@/project/session';
import { findPack, getStyle } from '@/packs/registry';
import { updateProject, useProjectStore } from '@/project/store';
import { OUTPUT_LOGICAL_SIZES } from '@/project/types';
import { useProgram } from './DerivedProvider';
import { useFileDrop } from './dropImport';
import { FullscreenControls } from './FullscreenControls';
import { EmptyStageCard } from './wizard/EmptyStageCard';
import { useThemeDraftPreview } from './theme-park/useThemeDraftPreview';
import { setPreviewFullscreenTarget, usePreviewFullscreen } from './previewFullscreen';
import { clock, onPausedSeek, seek, usePlayback } from './playback';
import { log } from './output';
import { useTranslation } from 'react-i18next';
import { t as translate } from '@/i18n';

const QUERY = new URLSearchParams(window.location.search);
const ENGINE = QUERY.get('engine') === 'legacy' ? 'legacy' : 'kernel';
/** `?resolution=1.5`：固定渲染倍率（经纹理池吸附，与原版 runtime 的算法相同）。对照测试用。 */
const FIXED_RESOLUTION = Number(QUERY.get('resolution')) || null;

/** 预览倍率按显示缩放取整档，避免拖窗口时反复重建场景。 */
const resolvePreviewResolution = (scale: number, setting: number) => {
    const target = Math.max(0.5, Math.min(2, scale * (window.devicePixelRatio || 1) * setting));
    return [0.5, 0.75, 1, 1.25, 1.5, 2].find(step => step >= target - 0.05) ?? 2;
};

interface StageHandle {
    renderOnce: () => void;
    rebuild: () => void;
    generation: number;
}

function KernelStage({ host, scale, onReady }: { host: HTMLDivElement; scale: number; onReady: (handle: StageHandle) => void }) {
    // 主题编辑器开着时，预览画的是它的草稿（只影响预览，不进工程）。
    const project = useThemeDraftPreview(useProjectStore(state => state.project));
    const program = useProgram();
    const analysis = useSession(state => state.analysis);
    const coverColors = useSession(state => state.coverColors);
    const coverBlob = useSession(state => state.coverBlob);
    const layerImages = useSession(state => state.assetBlobs);
    const playing = usePlayback(state => state.playing);
    const kernelRef = useRef<LumiKernel | null>(null);
    const [error, setError] = useState<string | null>(null);
    const logical = OUTPUT_LOGICAL_SIZES[project.aspect];
    const resolution = FIXED_RESOLUTION
        ? snapResolutionToTexturePool(logical.width, logical.height, FIXED_RESOLUTION)
        : resolvePreviewResolution(scale, project.tuning.kernel.previewResolution);
    const lines = useMemo(() => program.lines.map(line => line.line), [program]);

    const theme = activeTheme(project);
    const typography = useReadyTypography();
    const { tuning, meta } = project;
    const look = useMemo<KernelLook>(() => ({
        ...renderFonts({ ...project, typography }),
        tunings: tuning,
        metadata: { title: meta.title || null, artist: meta.artist || null, album: meta.album || null },
        coverColors,
        cover: coverBlob,
        layerImages,
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [theme, typography, tuning, meta, coverColors, coverBlob, layerImages]);

    // 用 ref 保存最新输入，kernel 异步创建完成时拿到的是当下的值。
    const latest = useRef({ look, program, lines, analysis, logical, resolution });
    latest.current = { look, program, lines, analysis, logical, resolution };

    useEffect(() => {
        let disposed = false;
        let created: LumiKernel | null = null;
        void import('@/kernel/runtime').then(async ({ LumiKernel }) => {
            const input = latest.current;
            const kernel = await LumiKernel.create({
                ...input.look,
                width: input.logical.width,
                height: input.logical.height,
                resolution: input.resolution,
                program: input.program,
                lines: input.lines,
                audio: input.analysis,
                mount: host,
                clock,
            });
            if (disposed) {
                kernel.destroy();
                return;
            }
            created = kernel;
            kernelRef.current = kernel;
            setPreviewKernel(kernel);
            kernel.setPlaying(!clock.paused);
            void kernel.setAssetClips(clipsRef.current);
            void kernel.setBackgroundClips(backgroundsRef.current);
            kernel.refresh();
            onReady({ renderOnce: () => kernel.refresh(), rebuild: () => kernel.rebuild(), generation: Date.now() });
        }).catch(reason => {
            if (!disposed) {
                const message = translate('song:preview.failed', { message: (reason as Error).message });
                setError(message);
                log(message, 'error');
            }
        });
        return () => {
            disposed = true;
            if (created) setPreviewKernel(null);
            created?.destroy();
            kernelRef.current = null;
        };
        // 内核只在挂载时创建一次；之后的变化都就地下发。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [host]);

    useEffect(() => {
        kernelRef.current?.setProgram(program, lines);
    }, [program, lines]);

    useEffect(() => {
        const kernel = kernelRef.current;
        if (!kernel) return;
        void kernel.setLook(look).then(() => onReady({ renderOnce: () => kernel.refresh(), rebuild: () => kernel.rebuild(), generation: Date.now() }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [look]);

    useEffect(() => {
        kernelRef.current?.setAudio(analysis);
    }, [analysis]);

    // 素材片段：随工程与编排变化（拖动时频繁，只重建素材精灵，不动场景）。
    const assetClips = useProjectStore(state => state.project.assetClips);
    const assets = useProjectStore(state => state.project.assets);
    const resolvedClips = useMemo(() => resolveAssetClips(assetClips, program, new Set(assets.map(item => item.id))).resolved, [assetClips, assets, program]);
    const clipsRef = useRef(resolvedClips);
    clipsRef.current = resolvedClips;
    useEffect(() => {
        void kernelRef.current?.setAssetClips(resolvedClips);
    }, [resolvedClips]);

    const backgroundClips = useProjectStore(state => state.project.backgroundClips);
    const resolvedBackgrounds = useMemo(() => resolveBackgroundClips(backgroundClips, program, new Set(assets.map(item => item.id))).resolved, [backgroundClips, assets, program]);
    const backgroundsRef = useRef(resolvedBackgrounds);
    backgroundsRef.current = resolvedBackgrounds;
    useEffect(() => {
        void kernelRef.current?.setBackgroundClips(resolvedBackgrounds);
    }, [resolvedBackgrounds]);

    useEffect(() => {
        kernelRef.current?.resize(logical.width, logical.height, resolution);
    }, [logical.width, logical.height, resolution]);

    useEffect(() => {
        kernelRef.current?.setPlaying(playing);
        if (!playing) kernelRef.current?.refresh();
    }, [playing]);

    useEffect(() => onPausedSeek(() => kernelRef.current?.refresh()), []);

    return error ? <div className="absolute bottom-4 left-4 rounded-md bg-red-950/90 px-3 py-2 text-sm text-red-200">{error}</div> : null;
}

/** 路线 A：一个包一个原版 runtime。只用于对照 folia 的渲染基线。 */
function LegacyStage({ host, onReady }: { host: HTMLDivElement; onReady: (handle: StageHandle) => void }) {
    const project = useProjectStore(state => state.project);
    const program = useProgram();
    const lines = useMemo(() => program.lines.map(line => line.line), [program]);
    const runtimeRef = useRef<PackRuntimeHandle | null>(null);
    const [nonce, setNonce] = useState(0);
    const theme = activeTheme(project);
    const { seed, meta } = project;
    // 路线 A 只认识 folia 的两个原版 runtime（对照测试专用）。
    const pack = (project.direction.pack === 'sonnet' ? 'sonnet' : 'tempera') as LegacyPackId;
    const sonnetTuning = packTuningOf<SonnetTuning>(project, 'sonnet');
    const temperaTuning = packTuningOf<TemperaTuning>(project, 'tempera');

    useEffect(() => {
        const controller = new AbortController();
        let handle: PackRuntimeHandle | null = null;
        mountPack(pack, {
            host,
            lines,
            seed,
            theme,
            currentTime: clock,
            paused: clock.paused,
            title: meta.title || null,
            artist: meta.artist || null,
            sonnetTuning,
            temperaTuning,
            signal: controller.signal,
        }).then(runtime => {
            if (controller.signal.aborted) {
                runtime.destroy();
                return;
            }
            handle = runtime;
            runtimeRef.current = runtime;
            runtime.setPaused(clock.paused);
            runtime.renderOnce();
            onReady({ renderOnce: () => runtime.renderOnce(), rebuild: () => setNonce(value => value + 1), generation: Date.now() });
        });
        return () => {
            controller.abort();
            handle?.destroy();
            if (runtimeRef.current === handle) runtimeRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pack, lines, seed, theme, meta.title, meta.artist, project.tuning.packs, host, nonce]);

    useEffect(() => onPausedSeek(() => runtimeRef.current?.renderOnce()), []);
    return null;
}

/** 选中镜头时，在预览上用虚线框标出它的构图留给文字的区域（镜头运动之前的位置）。 */
function TextRegionOverlay({ width, height, scale }: { width: number; height: number; scale: number }) {
    const { t } = useTranslation('song');
    const selection = useSession(state => state.selection);
    const program = useProgram();
    if (selection.type !== 'shot') return null;
    const shot = program.paragraphs.find(p => p.id === selection.paragraphId)?.shots.find(s => s.id === selection.shotId);
    if (!shot) return null;
    const region = findPack(shot.pack)?.textRegion?.(getStyle(shot.style)?.kind ?? '');
    if (!region) return null;
    return (
        <div
            className="pointer-events-none absolute border border-dashed border-amber-300/80"
            style={{
                left: (region.cx - region.w / 2) * width * scale,
                top: (region.cy - region.h / 2) * height * scale,
                width: region.w * width * scale,
                height: region.h * height * scale,
                transform: `rotate(${region.rotation}rad)`,
            }}
        >
            <span className="absolute -top-4 left-0 text-[10px] text-amber-300/90">{t('preview.textRegion')}</span>
        </div>
    );
}

/** 画面里接近 color 的像素的重心（逻辑像素）。flipY：WebGL readPixels 的行是自下而上的。 */
const colorCentroidOf = (pixels: ArrayLike<number>, width: number, height: number, color: string, flipY: boolean, pixelScale: number) => {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * 4;
            if (Math.abs(pixels[i] - r) > 40 || Math.abs(pixels[i + 1] - g) > 40 || Math.abs(pixels[i + 2] - b) > 40) continue;
            sumX += x + 0.5;
            sumY += (flipY ? height - 1 - y : y) + 0.5;
            count += 1;
        }
    }
    return count === 0 ? null : { x: sumX / count / pixelScale, y: sumY / count / pixelScale, count };
};

export function Preview() {
    const program = useProgram();
    const { t } = useTranslation('song');
    const aspect = useProjectStore(state => state.project.aspect);
    const backgroundColor = activeTheme(useThemeDraftPreview(useProjectStore(state => state.project))).backgroundColor;
    const outerRef = useRef<HTMLDivElement>(null);
    const [host, setHost] = useState<HTMLDivElement | null>(null);
    const [scale, setScale] = useState(0.5);
    const [stage, setStage] = useState<StageHandle | null>(null);
    const logical = OUTPUT_LOGICAL_SIZES[aspect];
    // 拖到画面上：图片放到播放头处，视频设为当前段落的背景（其余文件照常按类型导入）。
    const drop = useFileDrop('stage');
    const fullscreen = usePreviewFullscreen();

    useEffect(() => {
        setPreviewFullscreenTarget(outerRef.current);
        return () => setPreviewFullscreenTarget(null);
    }, []);

    useEffect(() => {
        const outer = outerRef.current;
        if (!outer) return;
        const fit = () => {
            // 全屏时画面贴满，不留边。
            const padding = document.fullscreenElement === outer ? 0 : 24;
            const width = Math.max(1, outer.clientWidth - padding * 2);
            const height = Math.max(1, outer.clientHeight - padding * 2);
            setScale(Math.min(width / logical.width, height / logical.height));
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(outer);
        return () => observer.disconnect();
    }, [logical.width, logical.height]);

    // Playwright 基线用的钩子。
    useEffect(() => {
        window.__lumi = {
            loadLyrics: (fileName, content) => updateProject(p => ({ ...p, lyrics: { fileName, content } })),
            setPack: next => updateProject(p => ({ ...p, direction: { ...p.direction, mode: 'single', pack: next } })),
            setSeed: next => updateProject(p => ({ ...p, seed: next })),
            setDark: dark => updateProject(p => ({ ...p, theme: { ...p.theme, variant: dark ? 'dark' : 'light' } })),
            patchTheme: patch => updateProject(p => ({
                ...p,
                theme: { ...p.theme, dual: { dark: { ...p.theme.dual.dark, ...patch }, light: { ...p.theme.dual.light, ...patch } } },
            })),
            setPostProcess: enabled => updateProject(p => ({
                ...p,
                tuning: {
                    packs: Object.fromEntries(Object.entries(p.tuning.packs).map(([id, value]) => [
                        id,
                        value && typeof value === 'object' && 'postProcessEnabled' in value ? { ...value, postProcessEnabled: enabled } : value,
                    ])),
                    kernel: { ...p.tuning.kernel, postProcess: { ...p.tuning.kernel.postProcess, enabled } },
                },
            })),
            setSubtitles: mode => updateProject(p => ({
                ...p,
                tuning: { ...p.tuning, kernel: { ...p.tuning.kernel, subtitles: { ...p.tuning.kernel.subtitles, mode } } },
            })),
            patchTuning: (scope, patch) => updateProject(p => (scope === 'kernel'
                ? { ...p, tuning: { ...p.tuning, kernel: { ...p.tuning.kernel, ...patch } } }
                : { ...p, tuning: { ...p.tuning, packs: { ...p.tuning.packs, [scope]: { ...packTuningOf<object>(p, scope), ...patch } } } })),
            seek,
            renderOnce: () => stage?.renderOnce(),
            rebuild: () => stage?.rebuild(),
            runtimeGeneration: stage?.generation ?? 0,
            engine: ENGINE,
            setFoliaCompatible: () => updateProject(p => ({ ...p, engineParams: FOLIA_COMPATIBLE_PARAMS })),
            lockShot: (paragraphIndex, shotIndex, style) => {
                const shot = program.paragraphs[paragraphIndex]?.shots[shotIndex];
                if (shot) lockShotStyle(shot, style as StyleId);
            },
            setComponent: (paragraphIndex, shotIndex, slot, value) => {
                const shot = program.paragraphs[paragraphIndex]?.shots[shotIndex];
                if (shot) setShotComponent(shot, slot, value);
            },
            setMeta: meta => updateProject(p => ({ ...p, meta: { ...p.meta, ...meta } })),
            addTestImage: async (name, color) => {
                const canvas = new OffscreenCanvas(240, 320);
                const context = canvas.getContext('2d')!;
                context.fillStyle = color;
                context.beginPath();
                context.moveTo(120, 10);
                context.lineTo(230, 310);
                context.lineTo(10, 310);
                context.closePath();
                context.fill();
                context.fillStyle = '#ffffff';
                context.fillRect(90, 150, 60, 60);
                const blob = await canvas.convertToBlob({ type: 'image/png' });
                return (await importLibraryImage(new File([blob], `${name}.png`, { type: 'image/png' }))).id;
            },
            addClip: (assetId, clip) => addAssetClip(assetId, clip.timing as ClipTiming, clip as Partial<AssetClip>).id,
            updateClip: (clipId, patch) => updateAssetClip(clipId, patch as Partial<AssetClip>),
            clipFollow: (clipId, time) => {
                const clip = useProjectStore.getState().project.assetClips.find(item => item.id === clipId);
                const kernel = getPreviewKernel();
                return clip && kernel ? kernel.clipFollowAt(clip, time) : null;
            },
            colorCentroid: async (color, time) => {
                const kernel = getPreviewKernel();
                if (!kernel) return null;
                await kernel.prepareAt(time);
                kernel.renderAt(time);
                // 同一个任务里读默认帧缓冲：画布还没被合成清掉。
                const canvas = kernel.canvas;
                const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext;
                const pixels = new Uint8Array(canvas.width * canvas.height * 4);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                return colorCentroidOf(pixels, canvas.width, canvas.height, color, true, canvas.width / kernel.size.width);
            },
            videoCentroids: async (base64, times, color) => {
                const { ALL_FORMATS, BufferSource, CanvasSink, Input } = await import('mediabunny');
                const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
                const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
                const track = await input.getPrimaryVideoTrack();
                if (!track) throw new Error('没有视频轨');
                const sink = new CanvasSink(track, { poolSize: 1 });
                const results: Array<{ x: number; y: number; count: number } | null> = [];
                for (const time of times) {
                    const wrapped = await sink.getCanvas(time);
                    if (!wrapped) { results.push(null); continue; }
                    const canvas = wrapped.canvas as HTMLCanvasElement;
                    const data = (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, canvas.width, canvas.height).data;
                    results.push(colorCentroidOf(data, canvas.width, canvas.height, color, false, canvas.height / 720));
                }
                return results;
            },
            addTestVideo: async (name, seconds) => {
                const { BufferTarget, CanvasSource, Output, QUALITY_HIGH, WebMOutputFormat } = await import('mediabunny');
                const canvas = new OffscreenCanvas(320, 180);
                const context = canvas.getContext('2d')!;
                const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
                const source = new CanvasSource(canvas as unknown as HTMLCanvasElement, { codec: 'vp9', quality: QUALITY_HIGH });
                output.addVideoTrack(source, { frameRate: 30 });
                await output.start();
                const frames = Math.round(seconds * 30);
                for (let frame = 0; frame < frames; frame += 1) {
                    context.fillStyle = '#1e1b4b';
                    context.fillRect(0, 0, 320, 180);
                    context.fillStyle = '#00ff40';
                    context.fillRect((frame / frames) * 280, 0, 40, 180);
                    await source.add(frame / 30, 1 / 30);
                }
                await output.finalize();
                const blob = new Blob([(output.target as InstanceType<typeof BufferTarget>).buffer!], { type: 'video/webm' });
                return (await importLibraryVideo(new File([blob], `${name}.webm`, { type: 'video/webm' }))).id;
            },
            addBackground: (source, timing, patch) => addBackgroundClip(source as BackgroundSource, timing as ClipTiming, patch as Partial<BackgroundClip>).id,
            prepareFrame: async time => { await getPreviewKernel()?.prepareAt(time); },
            compareLayers: async (zipBase64, compositeBase64, time) => {
                const { unzipSync } = await import('fflate');
                const { ALL_FORMATS, BufferSource, Input, VideoSampleSink } = await import('mediabunny');
                const decode = async (bytes: Uint8Array) => {
                    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
                    const track = await input.getPrimaryVideoTrack();
                    if (!track) throw new Error('没有视频轨');
                    const sample = await new VideoSampleSink(track).getSample(time);
                    if (!sample) throw new Error('没有这一帧');
                    let frame = sample.toVideoFrame();
                    // mediabunny 把颜色与 alpha 两路拼成 I420A 帧时丢了色彩空间，按有限范围解释会把全范围的
                    // 数据拉伸（ffmpeg 解同一个文件是对的）。按轨道标的色彩空间重新包一次。
                    if (frame.format === 'I420A') {
                        const buffer = new Uint8Array(frame.allocationSize());
                        await frame.copyTo(buffer);
                        const rewrapped = new VideoFrame(buffer, {
                            format: 'I420A', codedWidth: frame.codedWidth, codedHeight: frame.codedHeight,
                            timestamp: frame.timestamp, colorSpace: await track.getColorSpace(),
                        });
                        frame.close();
                        frame = rewrapped;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = frame.displayWidth;
                    canvas.height = frame.displayHeight;
                    canvas.getContext('2d')!.drawImage(frame, 0, 0);
                    frame.close();
                    sample.close();
                    return canvas;
                };
                const bytes = (base64: string) => Uint8Array.from(atob(base64), char => char.charCodeAt(0));
                const entries = unzipSync(bytes(zipBase64));
                const files = Object.keys(entries).sort();
                const layers = files.filter(name => /\.(mp4|webm)$/.test(name));
                const composite = await decode(bytes(compositeBase64));
                const pixels = (source: HTMLCanvasElement) => source.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, source.width, source.height).data;
                const canvas = document.createElement('canvas');
                canvas.width = composite.width;
                canvas.height = composite.height;
                const context = canvas.getContext('2d', { willReadFrequently: true })!;
                let transparentRatio = 0;
                for (const [index, name] of layers.entries()) {
                    const frame = await decode(entries[name]);
                    // 最上面一层的透明比例（证明透明通道确实编进去了）。
                    if (index === layers.length - 1) {
                        const data = pixels(frame);
                        let transparent = 0;
                        for (let i = 3; i < data.length; i += 4) if (data[i] < 8) transparent += 1;
                        transparentRatio = transparent / (data.length / 4);
                    }
                    context.drawImage(frame, 0, 0, canvas.width, canvas.height);
                }
                const stacked = context.getImageData(0, 0, canvas.width, canvas.height).data;
                const expected = pixels(composite);
                let sum = 0;
                for (let i = 0; i < stacked.length; i += 4) {
                    sum += Math.abs(stacked[i] - expected[i]) + Math.abs(stacked[i + 1] - expected[i + 1]) + Math.abs(stacked[i + 2] - expected[i + 2]);
                }
                return { diff: sum / (stacked.length / 4) / 3, files, transparentRatio };
            },
            probeBar: async (base64, times) => {
                const { ALL_FORMATS, BufferSource, CanvasSink, Input } = await import('mediabunny');
                const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
                const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
                const track = await input.getPrimaryVideoTrack();
                if (!track) return times.map(() => null);
                const sink = new CanvasSink(track);
                const results: Array<number | null> = [];
                for (const time of times) {
                    const wrapped = await sink.getCanvas(time);
                    if (!wrapped) { results.push(null); continue; }
                    const canvas = wrapped.canvas as HTMLCanvasElement | OffscreenCanvas;
                    const context = (canvas as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;
                    const { width, height } = canvas;
                    const data = context.getImageData(0, 0, width, height).data;
                    // 测试色条（纯绿）：每一行取最长的一段连续绿色像素，零散的像素（颗粒、装饰）不算。
                    // 歌词、装饰线、转场会在一部分行上盖住色条（常常是大部分行），被盖住的行只会更短：
                    // 只用最长的那些行（至少 5 行达到的长度，防个别异常行）的中心取中位数。
                    const runs: Array<{ center: number; length: number }> = [];
                    for (let y = 0; y < height; y += 1) {
                        let best = { start: 0, length: 0 };
                        let runStart = -1;
                        for (let x = 0; x <= width; x += 1) {
                            const i = (y * width + x) * 4;
                            const green = x < width && data[i + 1] > 170 && data[i] < 90 && data[i + 2] < 130;
                            if (green && runStart < 0) runStart = x;
                            if (!green && runStart >= 0) {
                                if (x - runStart > best.length) best = { start: runStart, length: x - runStart };
                                runStart = -1;
                            }
                        }
                        if (best.length > 8) runs.push({ center: best.start + best.length / 2, length: best.length });
                    }
                    if (runs.length === 0) { results.push(null); continue; }
                    const lengths = runs.map(run => run.length).sort((a, b) => b - a);
                    const full = lengths[Math.min(4, lengths.length - 1)];
                    const centers = runs.filter(run => run.length >= full - 3).map(run => run.center).sort((a, b) => a - b);
                    results.push(centers[Math.floor(centers.length / 2)] / width);
                }
                return results;
            },
            setTypography: patch => updateProject(p => ({
                ...p,
                typography: normalizeTypography({
                    ...p.typography,
                    lyrics: { ...p.typography.lyrics, ...patch.lyrics },
                    subtitles: { ...p.typography.subtitles, ...patch.subtitles },
                }),
            })),
            setDirection: direction => updateProject(p => ({ ...p, direction: { ...p.direction, ...direction } })),
            inspect: () => ({
                paragraphs: program.paragraphs.map(paragraph => ({
                    lines: paragraph.lineIndices,
                    texts: paragraph.lineIndices.map(index => program.lines[index]?.line.fullText ?? ''),
                    startTime: paragraph.startTime,
                    endTime: paragraph.endTime,
                    pack: paragraph.direction.pack,
                    shots: paragraph.shots.map(shot => ({ id: shot.id, startTime: shot.startTime, endTime: shot.endTime, style: shot.style, locked: shot.locked })),
                    transition: paragraph.transitionOut && {
                        id: paragraph.transitionOut.id,
                        startTime: paragraph.transitionOut.startTime,
                        endTime: paragraph.transitionOut.endTime,
                    },
                })),
            }),
        };
    }, [stage, program]);

    return (
        <div ref={outerRef} {...drop.props} data-drop-target="stage" className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-zinc-950">
            <div
                className="relative overflow-hidden shadow-2xl ring-1 ring-zinc-800"
                style={{ width: logical.width * scale, height: logical.height * scale }}
            >
                <div
                    ref={setHost}
                    data-testid="stage"
                    aria-hidden="true"
                    className="absolute top-0 left-0 origin-top-left"
                    style={{
                        width: logical.width,
                        height: logical.height,
                        transform: `scale(${scale})`,
                        backgroundColor,
                    }}
                />
                <TextRegionOverlay width={logical.width} height={logical.height} scale={scale} />
                <ClipHandles width={logical.width} height={logical.height} scale={scale} />
            </div>
            {host && (ENGINE === 'legacy'
                ? <LegacyStage host={host} onReady={setStage} />
                : <KernelStage host={host} scale={scale} onReady={setStage} />)}
            {!fullscreen && <EmptyStageCard />}
            {fullscreen && <FullscreenControls container={outerRef} />}
            {drop.over && (
                <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-amber-400/80 bg-zinc-950/60 text-sm text-amber-200">
                    {t('preview.drop')}
                </div>
            )}
        </div>
    );
}
