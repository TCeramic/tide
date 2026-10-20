// src/app/lyrics/WordStrip.tsx
// 歌词面板的逐字条：放大的一行波形，上面每个计时单元一块，块宽就是时长。
// 拖块的左右边改开始 / 结束（相邻两块接着时一起动），拖块中间整块平移，拖虚线改整行的开始 / 结束；
// Shift 带着后面的一起移，Alt 不吸附。点空白处把播放头移过去。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LineAnchor } from '@/core/lyrics/edits';
import { detectOnsets } from '@/core/audio/onsets';
import { editableUnits, type Bounds } from '@/core/lyrics/wordEditing';
import type { TimedUnit } from '@/core/lyrics/wordTiming';
import type { Line } from '@/core/types';
import { useSession } from '@/project/session';
import { clock, seek, usePlayback } from '../playback';
import { cx } from '../ui';
import { useTranslation } from 'react-i18next';
import { drawWaveform, prepareCanvas } from '../waveform';
import { startWordDrag, type WordDragTarget } from './wordDrag';

const PAD = 0.6;
const WAVE_HEIGHT = 64;
const UNIT_TOP = 72;
const UNIT_HEIGHT = 40;
export const STRIP_HEIGHT = UNIT_TOP + UNIT_HEIGHT + 8;

export const formatMs = (seconds: number) => {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    return `${minutes}:${(safe - minutes * 60).toFixed(3).padStart(6, '0')}`;
};

export function WordStrip({ line, anchor, limit, selected, onSelect, snap, preview, disabled }: {
    line: Line;
    anchor: LineAnchor;
    limit: Bounds;
    selected: number | null;
    onSelect: (index: number) => void;
    snap: boolean;
    /** 打点时的实时结果（盖过这一行现在的单元）。 */
    preview?: TimedUnit[] | null;
    disabled?: boolean;
}) {
    const analysis = useSession(state => state.analysis);
    const { t: tr } = useTranslation(['song', 'arrange']);
    const host = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const [width, setWidth] = useState(600);
    const [dragging, setDragging] = useState(false);
    const time = usePlayback(state => state.time);
    const units = useMemo(() => preview ?? editableUnits(line), [preview, line]);

    useEffect(() => {
        const element = host.current;
        if (!element) return;
        const observer = new ResizeObserver(entries => setWidth(Math.max(200, entries[0].contentRect.width)));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const from = line.startTime - PAD;
    const to = line.endTime + PAD;
    const pps = width / Math.max(0.2, to - from);
    const x = (t: number) => (t - from) * pps;
    const onsets = useMemo(() => (analysis ? detectOnsets(analysis) : []), [analysis]);

    useEffect(() => {
        const element = canvas.current;
        if (!element) return;
        const context = prepareCanvas(element, width, WAVE_HEIGHT);
        if (!context || !analysis) return;
        drawWaveform(context, analysis, width, WAVE_HEIGHT, px => from + px / pps, 'rgba(161,161,170,0.5)');
    }, [analysis, width, from, pps]);

    const timeAt = (clientX: number) => {
        const rect = host.current?.getBoundingClientRect();
        return from + (clientX - (rect?.left ?? 0)) / pps;
    };
    const drag = (event: React.PointerEvent, target: WordDragTarget) => {
        if (disabled) return;
        startWordDrag(event, target, {
            anchor,
            line,
            limit,
            timeAt,
            pixelsPerSecond: pps,
            snap,
            snapTargets: () => [...onsets, clock.get()].sort((a, b) => a - b),
            onDragStart: () => setDragging(true),
            onDragEnd: () => setDragging(false),
            onTap: time => seek(Math.max(0, time)),
        });
    };

    const playing = units.findIndex(unit => time >= unit.startTime && time < unit.endTime);
    const visibleOnsets = onsets.filter(t => t >= from && t <= to);

    return (
        <div
            ref={host}
            data-testid="word-strip"
            className="relative w-full overflow-hidden rounded border border-zinc-800 bg-zinc-950 select-none"
            style={{ height: STRIP_HEIGHT, touchAction: 'none' }}
            onPointerDown={event => { if (event.button === 0 && !disabled) seek(Math.max(0, timeAt(event.clientX))); }}
        >
            <canvas ref={canvas} className="pointer-events-none absolute top-0 left-0" style={{ width, height: WAVE_HEIGHT }} />
            {snap && visibleOnsets.map(t => (
                <div key={t} className="pointer-events-none absolute top-0 h-2 w-px bg-sky-400/60" style={{ left: x(t) }} />
            ))}
            {/* 行的范围 */}
            <div
                aria-label={tr('words.line')}
                title={tr('words.lineHint')}
                onPointerDown={event => drag(event, { type: 'line-move' })}
                className={cx('absolute top-0 bottom-0 bg-amber-400/5 hover:bg-amber-400/10', disabled ? 'pointer-events-none' : 'cursor-grab')}
                style={{ left: x(line.startTime), width: x(line.endTime) - x(line.startTime) }}
            />
            {(['start', 'end'] as const).map(edge => (
                <div
                    key={edge}
                    aria-label={edge === 'start' ? tr('arrange:timeline.lineStart') : tr('arrange:timeline.lineEnd')}
                    onPointerDown={event => drag(event, { type: 'line', edge })}
                    className="absolute top-0 bottom-0 z-10 w-2 -translate-x-1/2 cursor-ew-resize border-x border-dashed border-amber-400/60 hover:bg-amber-400/20"
                    style={{ left: x(edge === 'start' ? line.startTime : line.endTime) }}
                />
            ))}
            {units.map((unit, index) => {
                const left = x(unit.startTime);
                const unitWidth = Math.max(2, x(unit.endTime) - left);
                return (
                    <div
                        key={index}
                        data-unit-index={index}
                        title={`${unit.text} · ${formatMs(unit.startTime)} · ${(unit.endTime - unit.startTime).toFixed(3)}s`}
                        onPointerDown={event => { onSelect(index); drag(event, { type: 'move', index }); }}
                        className={cx(
                            // 轮廓用内描边而不是 border：border 占位置，边上的把手够不到最外面那一像素。
                            'absolute z-20 flex cursor-grab items-center justify-center overflow-hidden rounded-sm text-sm whitespace-nowrap ring-1 ring-inset',
                            index === selected ? 'bg-amber-400/30 text-amber-50 ring-amber-300' : 'bg-sky-900/50 text-zinc-100 ring-sky-700/80',
                            index === playing && 'ring-2 ring-emerald-300',
                            preview && 'opacity-80',
                        )}
                        style={{ left, width: unitWidth, top: UNIT_TOP, height: UNIT_HEIGHT }}
                    >
                        {unitWidth > 10 ? unit.text : ''}
                        <div
                            aria-label={tr('arrange:timeline.wordStart', { text: unit.text })}
                            onPointerDown={event => { onSelect(index); drag(event, { type: 'edge', index, edge: 'start' }); }}
                            className="absolute top-0 left-0 h-full w-1.5 cursor-ew-resize hover:bg-amber-300/70"
                        />
                        <div
                            aria-label={tr('arrange:timeline.wordEnd', { text: unit.text })}
                            onPointerDown={event => { onSelect(index); drag(event, { type: 'edge', index, edge: 'end' }); }}
                            className="absolute top-0 right-0 h-full w-1.5 cursor-ew-resize hover:bg-amber-300/70"
                        />
                    </div>
                );
            })}
            {time >= from && time <= to && (
                <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-emerald-300" style={{ left: x(time) }} />
            )}
            <div className="pointer-events-none absolute right-1 bottom-0.5 text-[10px] text-zinc-500">
                {dragging ? tr('words.dragHint') : `${formatMs(line.startTime)} – ${formatMs(line.endTime)}`}
            </div>
        </div>
    );
}
