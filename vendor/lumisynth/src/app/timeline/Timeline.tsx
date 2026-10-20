// src/app/timeline/Timeline.tsx
// 多轨时间轴（底部面板）：刻度、波形、歌词行（拖动行边界做时间校正）、段落（含转场区间）、shot。
// 点空白处 seek，点块选中（检查器里编辑）。播放头与跟随滚动走 rAF，不触发 React 重渲染。
import { resolveBackgroundClips, type ResolvedBackgroundClip } from '@/core/assets/background';
import { backgroundMenu, describeBackground } from '../backgroundActions';
import { resolveAssetClips, type ResolvedAssetClip } from '@/core/assets/clips';
import { updateAssetClip, updateBackgroundClip } from '@/project/assets';
import { clipMenu, slotLabel, timingLabel } from '../clipActions';
import { useTranslation } from 'react-i18next';
import { packShortLabel, paragraphKindLabel } from '@/i18n/catalog';
import { moveParagraphStart } from '@/project/structure';
import { log } from '../output';
import { useCoarsePointer } from '../mobile/uiMode';
import { paragraphMenu, shotMenu, structureMenuItems } from '../arrangeActions';
import { showContextMenu } from '../workbench/ContextMenu';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Lock, Magnet, Minus, Plus, Link2 } from 'lucide-react';
import type { LumiParagraph, LumiShot, PackId } from '@/compiler/types';
import { getStyle, getTransition } from '@/packs/registry';
import { anchorOfLine } from '@/core/lyrics/edits';
import type { Line } from '@/core/types';
import { setLineBounds, setLyricOffset } from '@/project/lyrics';
import { drawWaveform, prepareCanvas } from '../waveform';
import { setSession, useSession, type Selection } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { useProgram } from '../DerivedProvider';
import { packColor } from '../StylePanel';
import { clock, seek, usePlayback } from '../playback';
import { useProjectDuration } from '../Transport';
import { cx, rangeFill } from '../ui';
import { setLayout, useLayout } from '../workbench/layout';
import { MIN_WORD_ZOOM, TimelineWords } from './TimelineWords';
import { onRevealInTimeline, revealScroll } from './reveal';
import { startWordDrag } from '../lyrics/wordDrag';
import { detectOnsets } from '@/core/audio/onsets';

const LABEL_WIDTH = 76;
/** 块的颜色来自风格包自己声明的颜色（StylePack.color）。 */
const packBlockStyle = (pack: PackId, selected: boolean): React.CSSProperties => {
    const color = packColor(pack);
    return {
        backgroundColor: `color-mix(in srgb, ${color} ${selected ? 42 : 20}%, #18181b)`,
        // 未选中时边框只比底色亮一点；选中时接近白色，一眼能看出来。
        borderColor: selected ? `color-mix(in srgb, ${color} 35%, white)` : `color-mix(in srgb, ${color} 45%, #18181b)`,
        color: selected ? '#fafafa' : '#e4e4e7',
    };
};

const isInterlude = (line: Line) => line.fullText === '......';

const niceStep = (zoom: number) => {
    const minPixels = 70;
    return [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find(step => step * zoom >= minPixels) ?? 300;
};

const formatRuler = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
};

function Waveform({ zoom, scrollLeft, viewport, height }: { zoom: number; scrollLeft: number; viewport: number; height: number }) {
    const analysis = useSession(state => state.analysis);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = prepareCanvas(canvas, viewport, height);
        if (!context || !analysis) return;
        drawWaveform(context, analysis, viewport, height, x => (scrollLeft + x) / zoom);
    }, [analysis, zoom, scrollLeft, viewport, height]);
    const hasAudio = useProjectStore(state => state.project.audio !== null);
    const { t } = useTranslation('arrange');
    return (
        <>
            <canvas ref={canvasRef} className="pointer-events-none absolute top-0" style={{ left: scrollLeft, width: viewport, height }} />
            {!hasAudio && (
                // 没有音频时这一行是空的：告诉用户这里会出现什么、怎么放进来。
                <div className="pointer-events-none sticky left-0 flex h-full items-center px-3 text-[11px] text-zinc-600" style={{ width: viewport }}>
                    {t('timeline.noAudio')}
                </div>
            )}
        </>
    );
}

function Track({ label, height, children, onBackgroundPointerDown }: {
    label: string;
    height: number;
    children: React.ReactNode;
    onBackgroundPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
    return (
        <div className="relative border-b border-zinc-800/80" style={{ height }} onPointerDown={onBackgroundPointerDown}>
            <div className="sticky left-0 z-20 flex h-full items-center border-r border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-500" style={{ width: LABEL_WIDTH }}>
                {label}
            </div>
            <div className="absolute inset-y-0 right-0" style={{ left: LABEL_WIDTH }}>{children}</div>
        </div>
    );
}

const isSelected = (selection: Selection, type: string, id: string | number) => (
    (type === 'paragraph' && selection.type === 'paragraph' && selection.paragraphId === id)
    || (type === 'shot' && selection.type === 'shot' && selection.shotId === id)
    || (type === 'line' && selection.type === 'line' && selection.lineIndex === id)
);

export function Timeline() {
    const program = useProgram();
    const zoom = useLayout(state => state.timelineZoom);
    const follow = useLayout(state => state.timelineFollow);
    const wordMode = useLayout(state => state.timelineWords);
    const selection = useSession(state => state.selection);
    const { t } = useTranslation('arrange');
    const offset = useProjectStore(state => state.project.lyricEdits.offset);
    const duration = useProjectDuration();
    const scrollRef = useRef<HTMLDivElement>(null);
    const playheadRef = useRef<HTMLDivElement>(null);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [viewport, setViewport] = useState(800);
    const contentWidth = Math.ceil(duration * zoom) + 40;
    const lines = useMemo(() => program.lines.map(item => item.line), [program]);

    useLayoutEffect(() => {
        const element = scrollRef.current;
        if (!element) return;
        const update = () => setViewport(Math.max(1, element.clientWidth - LABEL_WIDTH));
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // 播放头与跟随滚动。
    useEffect(() => {
        let frame = 0;
        const tick = () => {
            const element = scrollRef.current;
            const time = clock.get();
            const x = time * zoom;
            if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
            if (element && follow && usePlayback.getState().playing) {
                const visibleStart = element.scrollLeft;
                const visibleEnd = visibleStart + element.clientWidth - LABEL_WIDTH;
                if (x < visibleStart || x > visibleEnd - 60) element.scrollLeft = Math.max(0, x - (element.clientWidth - LABEL_WIDTH) * 0.2);
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [zoom, follow]);

    // 大纲、面包屑、剧本里点了一项：把它的时间范围滚进视野。
    const revealState = useRef({ zoom, contentWidth });
    revealState.current = { zoom, contentWidth };
    useEffect(() => onRevealInTimeline(({ start, end }) => {
        const element = scrollRef.current;
        if (!element) return;
        const { zoom: currentZoom, contentWidth: width } = revealState.current;
        const left = revealScroll(element.scrollLeft, element.clientWidth - LABEL_WIDTH, start * currentZoom, end * currentZoom, width);
        if (left !== null) element.scrollTo({ left, behavior: 'smooth' });
    }), []);

    const timeAt = useCallback((clientX: number) => {
        const element = scrollRef.current;
        if (!element) return 0;
        const rect = element.getBoundingClientRect();
        return Math.max(0, Math.min(duration, (clientX - rect.left - LABEL_WIDTH + element.scrollLeft) / zoom));
    }, [zoom, duration]);

    /** 刻度栏与播放头把手：按住拖动连续移动播放头。 */
    const scrubFromPointer = (event: ReactPointerEvent) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        event.preventDefault();
        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture(event.pointerId);
        seek(timeAt(event.clientX));
        const move = (moveEvent: PointerEvent) => seek(timeAt(moveEvent.clientX));
        const up = () => {
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', up);
            target.removeEventListener('pointercancel', up);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
    };

    /**
     * 轨道空白处：按住拖动平移视图（抓手），只点不拖则跳到该时刻。中键在任何位置都是平移。
     */
    const panOrSeek = (event: ReactPointerEvent) => {
        if (event.button !== 0 && event.button !== 1) return;
        const element = scrollRef.current;
        if (!element) return;
        event.preventDefault();
        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture(event.pointerId);
        const startX = event.clientX;
        const startScroll = element.scrollLeft;
        const middle = event.button === 1;
        let panning = middle;
        if (panning) element.style.cursor = 'grabbing';
        const move = (moveEvent: PointerEvent) => {
            const dx = moveEvent.clientX - startX;
            if (!panning && Math.abs(dx) > 3) {
                panning = true;
                element.style.cursor = 'grabbing';
            }
            if (panning) element.scrollLeft = Math.max(0, startScroll - dx);
        };
        const up = (upEvent: PointerEvent) => {
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', up);
            target.removeEventListener('pointercancel', up);
            element.style.cursor = '';
            // 单击空白处（没拖动）：定位并取消选择。
            if (!panning && upEvent.type === 'pointerup') {
                seek(timeAt(upEvent.clientX));
                setSession({ selection: { type: 'none' } });
            }
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
    };

    // 原地缩放：缩放一变，在新的内容宽度渲染出来之后（布局提交后、绘制前）按锚点恢复滚动位置，
    // 让锚点时刻留在屏幕上同一个位置。滚轮 / 捏合以指针为锚点，按钮与滑块以播放头为锚点
    // （播放头不在视野里时用视野中心），其他来源（比如「放大后显示逐字」）以视野中心为锚点。
    const pendingAnchor = useRef<{ time: number; x: number } | null>(null);
    const previousZoom = useRef(zoom);
    useLayoutEffect(() => {
        const element = scrollRef.current;
        const previous = previousZoom.current;
        previousZoom.current = zoom;
        if (!element || previous === zoom) return;
        const width = Math.max(1, element.clientWidth - LABEL_WIDTH);
        const anchor = pendingAnchor.current ?? { time: (element.scrollLeft + width / 2) / previous, x: width / 2 };
        pendingAnchor.current = null;
        element.scrollLeft = Math.max(0, anchor.time * zoom - anchor.x);
        setScrollLeft(element.scrollLeft);
    }, [zoom]);
    const zoomAroundPlayhead = (next: number) => {
        const element = scrollRef.current;
        const clamped = Math.max(4, Math.min(400, next));
        if (element) {
            const width = Math.max(1, element.clientWidth - LABEL_WIDTH);
            const time = clock.get();
            const x = time * zoom - element.scrollLeft;
            pendingAnchor.current = x >= 0 && x <= width ? { time, x } : { time: (element.scrollLeft + width / 2) / zoom, x: width / 2 };
        }
        setLayout({ timelineZoom: clamped });
    };

    // 滚轮：直接滚动为左右平移，Ctrl 以鼠标位置为中心缩放，Alt 逐步移动播放头。
    // 必须是原生的非 passive 监听器，React 的 onWheel 里 preventDefault 不生效（会触发页面缩放）。
    const wheelState = useRef({ zoom, timeAt });
    wheelState.current = { zoom, timeAt };
    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;
        const onWheel = (event: WheelEvent) => {
            const { zoom: currentZoom, timeAt: at } = wheelState.current;
            const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
                const next = Math.max(4, Math.min(400, currentZoom * (delta < 0 ? 1.15 : 1 / 1.15)));
                pendingAnchor.current = { time: at(event.clientX), x: event.clientX - element.getBoundingClientRect().left - LABEL_WIDTH };
                setLayout({ timelineZoom: next });
            } else if (event.altKey) {
                const step = event.shiftKey ? 1 / 30 : 0.5;
                seek(Math.max(0, clock.get() + (delta > 0 ? step : -step)));
            } else {
                element.scrollLeft = Math.max(0, element.scrollLeft + delta);
            }
        };
        element.addEventListener('wheel', onWheel, { passive: false });
        return () => element.removeEventListener('wheel', onWheel);
    }, []);

    // 触屏：单指左右拖动是原生滚动（touch-action: pan-x，拖动时指针事件被取消，不会误触发跳转）；
    // 双指捏合以两指中点为中心缩放。捕获阶段监听，子元素抓了指针也收得到。
    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;
        const touches = new Map<number, number>();
        let pinch: { distance: number; zoom: number; anchorTime: number } | null = null;
        const spread = () => {
            const [a, b] = [...touches.values()];
            return { distance: Math.max(8, Math.abs(a - b)), center: (a + b) / 2 };
        };
        const down = (event: PointerEvent) => {
            if (event.pointerType !== 'touch') return;
            touches.set(event.pointerId, event.clientX);
            if (touches.size === 2) {
                const { distance, center } = spread();
                pinch = { distance, zoom: wheelState.current.zoom, anchorTime: wheelState.current.timeAt(center) };
            }
        };
        const move = (event: PointerEvent) => {
            if (!touches.has(event.pointerId)) return;
            touches.set(event.pointerId, event.clientX);
            if (!pinch || touches.size < 2) return;
            event.preventDefault();
            const { distance, center } = spread();
            const next = Math.max(4, Math.min(400, pinch.zoom * (distance / pinch.distance)));
            pendingAnchor.current = { time: pinch.anchorTime, x: center - element.getBoundingClientRect().left - LABEL_WIDTH };
            setLayout({ timelineZoom: next });
        };
        const up = (event: PointerEvent) => {
            touches.delete(event.pointerId);
            if (touches.size < 2) pinch = null;
        };
        element.addEventListener('pointerdown', down, { capture: true });
        element.addEventListener('pointermove', move, { capture: true, passive: false });
        element.addEventListener('pointerup', up, { capture: true });
        element.addEventListener('pointercancel', up, { capture: true });
        return () => {
            element.removeEventListener('pointerdown', down, { capture: true });
            element.removeEventListener('pointermove', move, { capture: true });
            element.removeEventListener('pointerup', up, { capture: true });
            element.removeEventListener('pointercancel', up, { capture: true });
        };
    }, []);

    // 按住行块中间拖：整行平移（逐字时间一起移），吸附行首到起音点 / 播放头，Alt 不吸附。只是点一下时什么都不改。
    const analysis = useSession(state => state.analysis);
    const onsets = useMemo(() => (analysis ? detectOnsets(analysis) : []), [analysis]);
    const moveLineFromPointer = (event: ReactPointerEvent, index: number) => {
        const line = lines[index];
        startWordDrag(event, { type: 'line-move' }, {
            anchor: anchorOfLine(line, index),
            line,
            limit: {
                start: index > 0 ? lines[index - 1].startTime + 0.05 : 0,
                end: index + 1 < lines.length ? lines[index + 1].endTime - 0.05 : Math.max(duration, line.endTime + 5),
            },
            timeAt,
            pixelsPerSecond: zoom,
            snap: true,
            snapTargets: () => [...onsets, clock.get()].sort((a, b) => a - b),
        });
    };

    // 拖动行边界：只改这一端的时间，并且不越过相邻行（行序号就是锚点，不能乱序）。
    const dragLineEdge = (event: ReactPointerEvent, index: number, edge: 'start' | 'end') => {
        event.stopPropagation();
        event.preventDefault();
        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture(event.pointerId);
        const line = lines[index];
        const anchor = anchorOfLine(line, index);
        const previous = lines[index - 1];
        const next = lines[index + 1];
        const move = (moveEvent: PointerEvent) => {
            const time = timeAt(moveEvent.clientX);
            // 时间轴显示的是加过整体偏移的时间（setLineBounds 自己换算回歌词文件的时间）。
            if (edge === 'start') {
                const min = previous ? previous.startTime + 0.05 : 0;
                setLineBounds(anchor, line, { startTime: Math.min(line.endTime - 0.05, Math.max(min, time)), endTime: line.endTime });
            } else {
                const max = next ? Math.max(next.endTime - 0.05, line.startTime + 0.05) : duration;
                setLineBounds(anchor, line, { startTime: line.startTime, endTime: Math.max(line.startTime + 0.05, Math.min(max, time)) });
            }
        };
        const up = () => {
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', up);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
    };

    // 拖动段落边界：吸附到允许范围（上一段段首之后、本段末行之内）里最近的行首，松手时移动段首。
    const [boundaryDrag, setBoundaryDrag] = useState<{ time: number } | null>(null);
    const dragParagraphStart = (event: ReactPointerEvent, paragraph: LumiParagraph) => {
        event.stopPropagation();
        event.preventDefault();
        const previous = program.paragraphs[paragraph.index - 1];
        if (!previous) return;
        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture(event.pointerId);
        const candidates = program.lines
            .map((line, index) => ({ index, time: line.line.startTime }))
            .filter(item => item.index > previous.lineIndices[0] && item.index <= paragraph.lineIndices.at(-1)!);
        let chosen = paragraph.lineIndices[0];
        const move = (moveEvent: PointerEvent) => {
            const time = timeAt(moveEvent.clientX);
            const nearest = candidates.reduce((best, item) => (Math.abs(item.time - time) < Math.abs(best.time - time) ? item : best), candidates[0]);
            if (!nearest) return;
            chosen = nearest.index;
            setBoundaryDrag({ time: nearest.time });
        };
        const up = () => {
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', up);
            target.removeEventListener('pointercancel', up);
            setBoundaryDrag(null);
            if (chosen !== paragraph.lineIndices[0]) moveParagraphStart(program, paragraph, chosen, message => log(message));
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
    };

    const step = niceStep(zoom);
    const ticks = useMemo(() => {
        const result: number[] = [];
        const first = Math.floor(scrollLeft / zoom / step) * step;
        const last = (scrollLeft + viewport) / zoom;
        for (let t = first; t <= last + step; t += step) result.push(t);
        return result;
    }, [scrollLeft, viewport, zoom, step]);

    const coarse = useCoarsePointer();
    const assetClips = useProjectStore(state => state.project.assetClips);
    const libraryAssets = useProjectStore(state => state.project.assets);
    const resolvedClips = useMemo(
        () => resolveAssetClips(assetClips, program, new Set(libraryAssets.map(item => item.id))).resolved,
        [assetClips, libraryAssets, program],
    );

    const backgroundClips = useProjectStore(state => state.project.backgroundClips);
    const resolvedBackgrounds = useMemo(
        () => resolveBackgroundClips(backgroundClips, program, new Set(libraryAssets.map(item => item.id))).resolved,
        [backgroundClips, libraryAssets, program],
    );

    // 拖动背景片段：与素材片段相同，挂载的片段一拖就改为绝对时间。
    const dragBackground = (event: ReactPointerEvent, clip: ResolvedBackgroundClip, mode: 'move' | 'start' | 'end') => {
        event.stopPropagation();
        event.preventDefault();
        setSession({ selection: { type: 'background', clipId: clip.id } });
        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture(event.pointerId);
        const originTime = timeAt(event.clientX);
        const end0 = Math.min(clip.end, Math.max(clip.start + 0.1, duration));
        let moved = false;
        const move = (moveEvent: PointerEvent) => {
            const delta = timeAt(moveEvent.clientX) - originTime;
            if (!moved && Math.abs(delta * zoom) < 3) return;
            moved = true;
            let start = clip.start;
            let end = end0;
            if (mode === 'move') {
                const shift = Math.max(-clip.start, delta);
                start += shift;
                end += shift;
            } else if (mode === 'start') start = Math.min(end0 - 0.1, Math.max(0, clip.start + delta));
            else end = Math.max(clip.start + 0.1, end0 + delta);
            updateBackgroundClip(clip.id, { timing: { type: 'absolute', start, end } }, 'drag');
        };
        const up = () => {
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', up);
            target.removeEventListener('pointercancel', up);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
    };

    // 拖动素材片段：整体平移或拖两端改长短。挂在歌词 / 镜头上的片段一拖就改为绝对时间。
    const dragClip = (event: ReactPointerEvent, clip: ResolvedAssetClip, mode: 'move' | 'start' | 'end') => {
        event.stopPropagation();
        event.preventDefault();
        setSession({ selection: { type: 'clip', clipId: clip.id } });
        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture(event.pointerId);
        const originTime = timeAt(event.clientX);
        let moved = false;
        const move = (moveEvent: PointerEvent) => {
            const delta = timeAt(moveEvent.clientX) - originTime;
            if (!moved && Math.abs(delta * zoom) < 3) return;
            moved = true;
            let start = clip.start;
            let end = clip.end;
            if (mode === 'move') {
                const shift = Math.max(-clip.start, delta);
                start += shift;
                end += shift;
            } else if (mode === 'start') start = Math.min(clip.end - 0.1, Math.max(0, clip.start + delta));
            else end = Math.max(clip.start + 0.1, clip.end + delta);
            updateAssetClip(clip.id, { timing: { type: 'absolute', start, end }, lead: 0, tail: 0 }, 'drag');
        };
        const up = () => {
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', up);
            target.removeEventListener('pointercancel', up);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
    };
    const select = (next: Selection) => setSession({ selection: next });
    const block = (start: number, end: number) => ({ left: start * zoom, width: Math.max(2, (end - start) * zoom) });

    return (
        <div className="flex h-full flex-col">
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-800 px-2 text-xs text-zinc-400">
                <button type="button" className="rounded p-1 hover:bg-zinc-800" aria-label={t('timeline.zoomOut')} onClick={() => zoomAroundPlayhead(zoom / 1.3)}><Minus size={13} /></button>
                <input
                    type="range" min={4} max={400} step={1} value={zoom}
                    onChange={event => zoomAroundPlayhead(Number(event.target.value))}
                    style={rangeFill(zoom, 4, 400)} className="w-28" aria-label={t('timeline.zoom')}
                />
                <button type="button" className="rounded p-1 hover:bg-zinc-800" aria-label={t('timeline.zoomIn')} onClick={() => zoomAroundPlayhead(zoom * 1.3)}><Plus size={13} /></button>
                <button
                    type="button"
                    onClick={() => setLayout({ timelineFollow: !follow })}
                    className={cx('flex items-center gap-1 rounded px-1.5 py-0.5', follow ? 'bg-zinc-800 text-zinc-100' : 'hover:bg-zinc-800')}
                    title={t('timeline.followHint')}
                >
                    <Magnet size={12} /> {t('timeline.follow')}
                </button>
                <button
                    type="button"
                    aria-pressed={wordMode}
                    onClick={() => setLayout({ timelineWords: !wordMode })}
                    className={cx('rounded px-1.5 py-0.5', wordMode ? 'bg-zinc-800 text-zinc-100' : 'hover:bg-zinc-800')}
                    title={t('timeline.wordsHint')}
                >
                    {t('timeline.words')}
                </button>
                {wordMode && zoom < MIN_WORD_ZOOM && (
                    <button type="button" className="shrink-0 rounded px-1.5 py-0.5 text-amber-300 hover:bg-zinc-800" onClick={() => setLayout({ timelineZoom: MIN_WORD_ZOOM * 2 })}>
                        {t('timeline.zoomForWords')}
                    </button>
                )}
                <div className="mx-1 h-4 w-px bg-zinc-800" />
                <label className="flex shrink-0 items-center gap-1 whitespace-nowrap" title={t('timeline.offsetHint')}>
                    {t('timeline.offset')}
                    <input
                        type="number" step={0.01} value={offset}
                        onChange={event => setLyricOffset(Number(event.target.value) || 0)}
                        className="h-6 w-20 rounded border border-zinc-700 bg-zinc-900 px-1 text-right text-zinc-100 tabular-nums"
                    />
                    s
                </label>
                <div className="flex-1" />
                <span className="truncate whitespace-nowrap text-zinc-500 pointer-coarse:hidden">{t('timeline.hint')}</span>
            </div>
            <div
                ref={scrollRef}
                data-testid="timeline-scroller"
                style={{ touchAction: 'pan-x' }}
                className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
                onScroll={event => setScrollLeft((event.target as HTMLDivElement).scrollLeft)}
            >
                <div className="relative" style={{ width: contentWidth + LABEL_WIDTH }}>
                    <Track label={t('timeline.tracks.time')} height={22} onBackgroundPointerDown={scrubFromPointer}>
                        {ticks.map(t => (
                            <div key={t} className="pointer-events-none absolute top-0 h-full border-l border-zinc-700/70 pl-1 text-[10px] text-zinc-500 tabular-nums" style={{ left: t * zoom }}>
                                {formatRuler(t)}
                            </div>
                        ))}
                    </Track>
                    <Track label={t('timeline.tracks.audio')} height={44} onBackgroundPointerDown={panOrSeek}>
                        <Waveform zoom={zoom} scrollLeft={scrollLeft} viewport={viewport} height={44} />
                    </Track>
                    {backgroundClips.length > 0 && (
                        <Track label={t('timeline.tracks.background')} height={coarse ? 40 : 24} onBackgroundPointerDown={panOrSeek}>
                            {resolvedBackgrounds.map((clip, index) => {
                                const selected = selection.type === 'background' && selection.clipId === clip.id;
                                return (
                                    <div
                                        key={clip.id}
                                        data-background-id={clip.id}
                                        onPointerDown={event => dragBackground(event, clip, 'move')}
                                        onDoubleClick={() => seek(clip.start)}
                                        onContextMenu={event => {
                                            setSession({ selection: { type: 'background', clipId: clip.id } });
                                            showContextMenu(event, backgroundMenu(clip));
                                        }}
                                        title={describeBackground(clip)}
                                        className={cx(
                                            'absolute flex cursor-grab items-center gap-1 overflow-hidden rounded-sm border px-1 text-[10px] whitespace-nowrap',
                                            selected ? 'border-violet-200 bg-violet-500/50 text-white' : 'border-violet-700 bg-violet-600/30 text-violet-100',
                                        )}
                                        style={{ ...block(clip.start, Math.min(clip.end, Math.max(clip.start + 0.1, duration))), top: 2, bottom: 2, zIndex: index }}
                                    >
                                        {clip.timing.type !== 'absolute' && <Link2 size={9} className="shrink-0" />}
                                        {describeBackground(clip)}
                                        <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-violet-200/70" onPointerDown={event => dragBackground(event, clip, 'start')} />
                                        <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-violet-200/70" onPointerDown={event => dragBackground(event, clip, 'end')} />
                                    </div>
                                );
                            })}
                        </Track>
                    )}
                    <Track label={t('timeline.tracks.lyrics')} height={wordMode && zoom >= MIN_WORD_ZOOM ? (coarse ? 48 : 38) : coarse ? 40 : 30} onBackgroundPointerDown={panOrSeek}>
                        {wordMode && zoom >= MIN_WORD_ZOOM && (
                            <TimelineWords lines={lines} zoom={zoom} scrollLeft={scrollLeft} viewport={viewport} duration={duration} timeAt={timeAt} isInterlude={isInterlude} />
                        )}
                        {!(wordMode && zoom >= MIN_WORD_ZOOM) && lines.map((line, index) => isInterlude(line) ? null : (
                            <div
                                key={index}
                                data-line-index={index}
                                onPointerDown={event => {
                                    event.stopPropagation();
                                    select({ type: 'line', lineIndex: index });
                                    moveLineFromPointer(event, index);
                                }}
                                onDoubleClick={() => seek(line.startTime)}
                                onContextMenu={event => {
                                    const paragraph = program.paragraphs.find(item => item.lineIndices.includes(index));
                                    if (!paragraph) return;
                                    select({ type: 'line', lineIndex: index });
                                    showContextMenu(event, structureMenuItems(program, paragraph, index));
                                }}
                                className={cx(
                                    'group absolute top-1 bottom-1 cursor-grab overflow-hidden rounded border px-1.5 text-[11px] leading-5 whitespace-nowrap',
                                    isSelected(selection, 'line', index)
                                        ? 'border-zinc-200 bg-zinc-600 text-zinc-50'
                                        : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500',
                                )}
                                style={block(line.startTime, line.endTime)}
                                title={line.fullText}
                            >
                                {line.fullText}
                                <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-amber-300/70" onPointerDown={event => dragLineEdge(event, index, 'start')} />
                                <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-amber-300/70" onPointerDown={event => dragLineEdge(event, index, 'end')} />
                            </div>
                        ))}
                    </Track>
                    <Track label={t('timeline.tracks.paragraphs')} height={coarse ? 40 : 28} onBackgroundPointerDown={panOrSeek}>
                        {program.paragraphs.map((paragraph: LumiParagraph) => (
                            <div key={paragraph.id}>
                                <div
                                    data-paragraph-index={paragraph.index}
                                    onPointerDown={event => {
                                        event.stopPropagation();
                                        select({ type: 'paragraph', paragraphId: paragraph.id });
                                    }}
                                    onContextMenu={event => {
                                        select({ type: 'paragraph', paragraphId: paragraph.id });
                                        showContextMenu(event, paragraphMenu(program, paragraph));
                                    }}
                                    className={cx(
                                        'absolute top-1 bottom-1 overflow-hidden rounded border px-1.5 text-[11px] leading-[18px] whitespace-nowrap',
                                    )}
                                    style={{
                                        ...block(paragraph.startTime, paragraph.transitionOut?.startTime ?? paragraph.endTime),
                                        ...packBlockStyle(paragraph.direction.pack, isSelected(selection, 'paragraph', paragraph.id)),
                                    }}
                                    title={`${paragraphKindLabel(paragraph.kind)} · ${paragraph.direction.pack}${paragraph.direction.source === 'ai' ? t('timeline.sourceAi') : paragraph.direction.source !== 'auto' ? t('timeline.sourceManual') : ''}`}
                                >
                                    {paragraphKindLabel(paragraph.kind)} · {packShortLabel(paragraph.direction.pack)}
                                </div>
                                {paragraph.index > 0 && (
                                    <div
                                        role="separator"
                                        aria-label={t('timeline.paragraphStart', { n: paragraph.index + 1 })}
                                        title={t('timeline.paragraphStartHint')}
                                        onPointerDown={event => dragParagraphStart(event, paragraph)}
                                        className="absolute top-0 bottom-0 z-10 w-2 -translate-x-1 cursor-col-resize hover:bg-amber-300/60"
                                        style={{ left: paragraph.startTime * zoom }}
                                    />
                                )}
                                {paragraph.transitionOut && (
                                    <div
                                        onPointerDown={event => {
                                            event.stopPropagation();
                                            select({ type: 'paragraph', paragraphId: paragraph.id });
                                        }}
                                        className={cx(
                                            'absolute top-1 bottom-1 rounded-sm border border-dashed',
                                            paragraph.transitionOut.source === 'user' ? 'border-fuchsia-300 bg-fuchsia-400/30' : 'border-zinc-400 bg-[repeating-linear-gradient(135deg,rgba(212,212,216,0.35)_0_3px,transparent_3px_6px)]',
                                        )}
                                        style={block(paragraph.transitionOut.startTime, paragraph.transitionOut.endTime)}
                                        title={t('timeline.transition', { name: getTransition(paragraph.transitionOut.id)?.label ?? paragraph.transitionOut.id })}
                                    />
                                )}
                            </div>
                        ))}
                    </Track>
                    {(assetClips.length > 0 || libraryAssets.length > 0) && (
                        <Track label={t('timeline.tracks.clips')} height={coarse ? 40 : 26} onBackgroundPointerDown={panOrSeek}>
                            {resolvedClips.map(clip => {
                                const asset = libraryAssets.find(item => item.id === clip.assetId);
                                const selected = selection.type === 'clip' && selection.clipId === clip.id;
                                return (
                                    <div
                                        key={clip.id}
                                        data-clip-id={clip.id}
                                        onPointerDown={event => dragClip(event, clip, 'move')}
                                        onDoubleClick={() => seek(clip.start)}
                                        onContextMenu={event => {
                                            setSession({ selection: { type: 'clip', clipId: clip.id } });
                                            showContextMenu(event, clipMenu(clip));
                                        }}
                                        title={clip.timing.type === 'absolute'
                                            ? t('timeline.clip', { name: asset?.name ?? clip.assetId, slot: slotLabel(clip.slot) })
                                            : t('timeline.clipFollowing', { name: asset?.name ?? clip.assetId, slot: slotLabel(clip.slot), timing: timingLabel(clip.timing.type) })}
                                        className={cx(
                                            'absolute top-1 bottom-1 flex cursor-grab items-center gap-1 overflow-hidden rounded-sm border px-1 text-[10px] whitespace-nowrap',
                                            selected ? 'border-emerald-200 bg-emerald-500/50 text-white' : 'border-emerald-700 bg-emerald-600/30 text-emerald-100',
                                        )}
                                        style={block(clip.start, Math.min(clip.end, Math.max(clip.start + 0.1, duration)))}
                                    >
                                        {clip.timing.type !== 'absolute' && <Link2 size={9} className="shrink-0" />}
                                        {asset?.name ?? clip.assetId}
                                        <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-emerald-200/70" onPointerDown={event => dragClip(event, clip, 'start')} />
                                        <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-emerald-200/70" onPointerDown={event => dragClip(event, clip, 'end')} />
                                    </div>
                                );
                            })}
                        </Track>
                    )}
                    <Track label={t('timeline.tracks.shots')} height={coarse ? 44 : 28} onBackgroundPointerDown={panOrSeek}>
                        {program.paragraphs.flatMap(paragraph => paragraph.shots.map((shot: LumiShot) => (
                            <div
                                key={shot.id}
                                onPointerDown={event => {
                                    event.stopPropagation();
                                    select({ type: 'shot', paragraphId: paragraph.id, shotId: shot.id });
                                }}
                                onDoubleClick={() => seek(shot.startTime)}
                                onContextMenu={event => {
                                    select({ type: 'shot', paragraphId: paragraph.id, shotId: shot.id });
                                    showContextMenu(event, shotMenu(program, paragraph, shot));
                                }}
                                className={cx(
                                    'absolute top-1 bottom-1 flex items-center gap-0.5 overflow-hidden rounded border px-1.5 text-[10px] whitespace-nowrap',
                                    shot.isBridge && 'opacity-60',
                                )}
                                style={{ ...block(shot.startTime, shot.endTime), ...packBlockStyle(shot.pack, isSelected(selection, 'shot', shot.id)) }}
                                title={shot.locked ? t('timeline.shotLocked', { style: shot.style }) : shot.style}
                            >
                                {shot.locked && <Lock size={9} className="shrink-0" />}
                                {getStyle(shot.style)?.kind ?? shot.style}
                            </div>
                        )))}
                    </Track>
                    {boundaryDrag && (
                        <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-amber-300" style={{ left: LABEL_WIDTH + boundaryDrag.time * zoom }} />
                    )}
                    <div
                        ref={playheadRef}
                        data-testid="timeline-playhead"
                        className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-amber-400"
                        style={{ left: LABEL_WIDTH }}
                    >
                        <div
                            onPointerDown={scrubFromPointer}
                            className="pointer-events-auto absolute -top-px -left-[6px] h-3.5 w-[13px] cursor-ew-resize bg-amber-400 [clip-path:polygon(0_0,100%_0,100%_60%,50%_100%,0_60%)]"
                            title={t('timeline.dragPlayhead')}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
