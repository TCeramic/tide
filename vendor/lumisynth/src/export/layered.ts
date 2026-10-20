// src/export/layered.ts
// 分层导出：同一个离屏内核，每一帧按层组各渲染一遍（其余层不画），每组编码成一个文件，
// 叠回去与合成导出一致。最底下一组不透明（含背景），其余是带透明通道的 WebM（VP9 + alpha，
// 由 mediabunny 拆成颜色与 alpha 两路编码）；浏览器编不了 VP9 时退回 PNG 序列。
// 后处理只加在选定的那一组上；暗角、颗粒可以各自单独成层。全部文件连同音频（WAV）与说明打成一个 zip。
import { zipSync } from 'fflate';
import { t } from '@/i18n';
import {
    BufferTarget,
    CanvasSource,
    getFirstEncodableVideoCodec,
    Mp4OutputFormat,
    Output,
    WebMOutputFormat,
} from 'mediabunny';
import { KERNEL_LAYERS, type KernelLayer } from '@/kernel/layerIds';
import { createKernel, ExportCancelled, QUALITIES, sliceAudio, yieldToUi, type ExportInput, type ExportProgress, type ExportSettings } from './exporter';

export type SeparateEffect = 'vignette' | 'grain';

export interface LayeredSettings {
    /** 从下到上的层组，每组是 KERNEL_LAYERS 里连续的几层，合起来覆盖全部层。 */
    groups: KernelLayer[][];
    /** 后处理加在哪一组上（null = 不加）。 */
    postTarget: number | null;
    /** 单独成层的后处理效果。 */
    separateEffects: SeparateEffect[];
}

/** 层的名字（界面与导出的文件名都用它，跟着界面语言）。 */
export const layerLabel = (layer: KernelLayer) => t(`export:layers.${layer}`);

/** 预设：两层（背景 / 歌词动画）、四层（背景 / 场景图形 / 文字 / 字幕）。 */
export const LAYER_PRESETS: Record<'two' | 'four', KernelLayer[][]> = {
    two: [['background', 'assetsBack'], ['graphics', 'assetsMid', 'text', 'assetsFront', 'subtitles', 'overlay', 'assetsTop']],
    four: [['background', 'assetsBack'], ['graphics', 'assetsMid'], ['text', 'assetsFront'], ['subtitles', 'overlay', 'assetsTop']],
};

/** 按「在哪些层之后切开」算出层组（切点是 KERNEL_LAYERS 的下标：在该层之后切）。 */
export const groupsFromSplits = (splits: Set<number>): KernelLayer[][] => {
    const groups: KernelLayer[][] = [[]];
    KERNEL_LAYERS.forEach((layer, index) => {
        groups.at(-1)!.push(layer);
        if (splits.has(index) && index < KERNEL_LAYERS.length - 1) groups.push([]);
    });
    return groups;
};

export const splitsFromGroups = (groups: KernelLayer[][]) => {
    const splits = new Set<number>();
    let count = 0;
    groups.slice(0, -1).forEach(group => {
        count += group.length;
        splits.add(count - 1);
    });
    return splits;
};

export const groupName = (group: KernelLayer[]) => group.map(layerLabel).join(' + ');

export interface LayeredResult {
    blob: Blob;
    files: string[];
    alphaMethod: 'webm-alpha' | 'png-sequence';
}

const effectNote = (effect: SeparateEffect) => ({ label: t(`export:effects.${effect}.label`), blend: t(`export:effects.${effect}.blend`) });

/** 16 位 PCM WAV。 */
const encodeWav = (buffer: AudioBuffer) => {
    const channels = buffer.numberOfChannels;
    const frames = buffer.length;
    const bytes = new ArrayBuffer(44 + frames * channels * 2);
    const view = new DataView(bytes);
    const write = (offset: number, text: string) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    write(0, 'RIFF');
    view.setUint32(4, 36 + frames * channels * 2, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, frames * channels * 2, true);
    const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
    let offset = 44;
    for (let i = 0; i < frames; i += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
            view.setInt16(offset, Math.max(-1, Math.min(1, data[channel][i])) * 0x7fff, true);
            offset += 2;
        }
    }
    return new Uint8Array(bytes);
};

interface Track {
    name: string;
    /** 渲染这一遍。 */
    render: (time: number) => void;
    transparent: boolean;
    output?: Output;
    source?: CanvasSource;
    /** PNG 序列退路：每帧一张。 */
    pngs?: Map<string, Uint8Array>;
}

export const exportLayered = async (
    input: ExportInput,
    settings: ExportSettings,
    layered: LayeredSettings,
    onProgress: (progress: ExportProgress) => void,
    signal?: AbortSignal,
): Promise<LayeredResult> => {
    const totalFrames = Math.max(1, Math.ceil((settings.end - settings.start) * settings.fps));
    onProgress({ phase: 'preparing', frame: 0, totalFrames, elapsed: 0, remaining: null });
    const quality = QUALITIES[settings.quality];
    const postProcess = input.look.tunings.kernel.postProcess;
    const separate = layered.separateEffects.filter(effect => postProcess.enabled && postProcess[effect] > 0);
    // 单独成层的效果不再进后处理链；凝彩的文字反色读的是文字下面的画面，文字与图形分开时读不到，关掉。
    const splitText = layered.groups.some(group => group.includes('text') !== group.includes('graphics'));
    const look = {
        ...input.look,
        tunings: {
            ...input.look.tunings,
            kernel: {
                ...input.look.tunings.kernel,
                postProcess: { ...postProcess, ...Object.fromEntries(separate.map(effect => [effect, 0])) },
            },
            packs: splitText
                ? Object.fromEntries(Object.entries(input.look.tunings.packs).map(([id, value]) => [
                    id,
                    value && typeof value === 'object' && 'textInversion' in value ? { ...value, textInversion: false } : value,
                ]))
                : input.look.tunings.packs,
        },
    };
    const kernel = await createKernel({ ...input, look }, settings, { transparent: true });
    const canEncode = Boolean(await getFirstEncodableVideoCodec(['vp9'], { width: settings.width, height: settings.height, quality, frameRate: settings.fps }));
    const bottomCodec = await getFirstEncodableVideoCodec(settings.format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'av1', 'vp8'], {
        width: settings.width, height: settings.height, quality, frameRate: settings.fps,
    });
    if (!bottomCodec) {
        kernel.destroy();
        throw new Error(t('export:errors.cannotEncodeSize', { width: settings.width, height: settings.height }));
    }

    const tracks: Track[] = [
        ...layered.groups.map((group, index): Track => ({
            name: `${String(index + 1).padStart(2, '0')}-${groupName(group)}`,
            transparent: index > 0,
            render: time => {
                kernel.setLayerMask(group);
                kernel.setPostProcessActive(layered.postTarget === index);
                kernel.renderAt(time);
            },
        })),
        ...separate.map((effect, index): Track => ({
            name: `${String(layered.groups.length + index + 1).padStart(2, '0')}-${t('export:readme.effectPrefix')}-${effectNote(effect).label}`,
            transparent: effect === 'vignette',
            render: time => kernel.renderEffect(effect, postProcess[effect], time),
        })),
    ];
    const alphaMethod: LayeredResult['alphaMethod'] = canEncode ? 'webm-alpha' : 'png-sequence';
    tracks.forEach(track => {
        if (track.transparent && !canEncode) {
            track.pngs = new Map();
            return;
        }
        const opaqueFormat = track.transparent ? 'webm' : settings.format;
        track.output = new Output({
            format: opaqueFormat === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
            target: new BufferTarget(),
        });
        track.source = new CanvasSource(kernel.canvas, {
            codec: track.transparent ? 'vp9' : bottomCodec,
            quality,
            keyFrameInterval: 2,
            ...(track.transparent ? { alpha: 'keep' as const } : {}),
        });
        track.output.addVideoTrack(track.source, { frameRate: settings.fps });
    });

    const onAbort = () => tracks.forEach(track => void track.output?.cancel());
    signal?.addEventListener('abort', onAbort, { once: true });
    const startedAt = performance.now();
    try {
        await Promise.all(tracks.map(track => track.output?.start()));
        for (let frame = 0; frame < totalFrames; frame += 1) {
            if (signal?.aborted) throw new ExportCancelled();
            const time = settings.start + frame / settings.fps;
            await kernel.prepareAt(time);
            for (const track of tracks) {
                track.render(time);
                if (track.source) {
                    await track.source.add(frame / settings.fps, 1 / settings.fps);
                } else if (track.pngs) {
                    const blob = await new Promise<Blob | null>(resolve => kernel.canvas.toBlob(resolve, 'image/png'));
                    if (blob) track.pngs.set(`${track.name}/${String(frame).padStart(6, '0')}.png`, new Uint8Array(await blob.arrayBuffer()));
                }
            }
            if (frame % 4 === 0) {
                const elapsed = (performance.now() - startedAt) / 1000;
                const rate = (frame + 1) / Math.max(elapsed, 0.001);
                onProgress({ phase: 'rendering', frame: frame + 1, totalFrames, elapsed, remaining: (totalFrames - frame - 1) / rate });
                await yieldToUi();
            }
        }
        if (signal?.aborted) throw new ExportCancelled();
        onProgress({ phase: 'finalizing', frame: totalFrames, totalFrames, elapsed: (performance.now() - startedAt) / 1000, remaining: 0 });

        const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
        for (const track of tracks) {
            if (track.output) {
                await track.output.finalize();
                const buffer = (track.output.target as BufferTarget).buffer;
                if (!buffer) throw new Error(t('export:errors.noOutput'));
                files[`${track.name}${track.output.format.fileExtension}`] = [new Uint8Array(buffer), { level: 0 }];
            } else if (track.pngs) {
                track.pngs.forEach((bytes, path) => { files[path] = [bytes, { level: 0 }]; });
            }
        }
        const audio = input.audio ? sliceAudio(input.audio, settings.start, settings.end) : null;
        const audioFile = `00-${t('export:readme.audioName')}.wav`;
        if (audio) files[audioFile] = [encodeWav(audio), { level: 0 }];
        const readme = [
            t('export:readme.title'),
            t('export:readme.summary', {
                width: settings.width, height: settings.height, fps: settings.fps,
                duration: (settings.end - settings.start).toFixed(2), start: settings.start.toFixed(2), end: settings.end.toFixed(2),
            }),
            '',
            t('export:readme.stacking'),
            ...tracks.map(track => {
                const effect = separate.find(item => track.name.endsWith(effectNote(item).label));
                const blend = effect ? effectNote(effect).blend : t('export:readme.blendNormal');
                const format = track.pngs ? t('export:readme.formatPng') : track.transparent ? t('export:readme.formatWebm') : t('export:readme.formatOpaque');
                return `  ${t('export:readme.track', { name: track.name, format, blend })}`;
            }),
            audio ? `  ${t('export:readme.audio', { file: audioFile })}` : '',
            '',
            layered.postTarget === null ? t('export:readme.postNone') : t('export:readme.postOn', { name: tracks[layered.postTarget].name }),
            splitText ? t('export:readme.inversionOff') : '',
            t('export:readme.wipe'),
            alphaMethod === 'png-sequence' ? t('export:readme.pngFallback') : '',
        ].filter(line => line !== undefined).join('\n');
        files[`${t('export:readme.fileName')}.txt`] = new TextEncoder().encode(readme);
        const zipped = zipSync(files as Parameters<typeof zipSync>[0]);
        return {
            blob: new Blob([zipped], { type: 'application/zip' }),
            files: Object.keys(files).filter(name => !name.includes('/') || name.endsWith('000000.png')),
            alphaMethod,
        };
    } catch (error) {
        await Promise.all(tracks.map(track => track.output?.cancel().catch(() => undefined)));
        if (signal?.aborted) throw new ExportCancelled();
        throw error;
    } finally {
        signal?.removeEventListener('abort', onAbort);
        kernel.destroy();
    }
};
