// src/app/timeline/TimelineWords.tsx
// 时间轴歌词轨的精确（逐字）模式：每行一个虚线框（拖两端改行的开始 / 结束），框里每个计时单元一块，
// 宽度就是时长；太窄时只画一道刻度，悬停看字、开始与时长。拖动与歌词面板的逐字条相同
// （见 lyrics/wordDrag.ts）：拖边改时间、拖中间平移、Shift 带着后面、吸附起音点与播放头、Alt 不吸附。
// 框顶上留出的一条（字块上方）按住拖是整行平移。
// 只画视野里的行。
import { useMemo } from 'react';
import { anchorOfLine } from '@/core/lyrics/edits';
import { detectOnsets } from '@/core/audio/onsets';
import { editableUnits } from '@/core/lyrics/wordEditing';
import type { Line } from '@/core/types';
import { setSession, useSession } from '@/project/session';
import { formatMs } from '../lyrics/WordStrip';
import { startWordDrag, type WordDragTarget } from '../lyrics/wordDrag';
import { clock } from '../playback';
import { cx } from '../ui';
import { useTranslation } from 'react-i18next';

/** 低于这个缩放（像素 / 秒）逐字挤在一起看不清，退回整行显示。 */
export const MIN_WORD_ZOOM = 30;

export function TimelineWords({ lines, zoom, scrollLeft, viewport, duration, timeAt, isInterlude }: {
    lines: Line[];
    zoom: number;
    scrollLeft: number;
    viewport: number;
    duration: number;
    timeAt: (clientX: number) => number;
    isInterlude: (line: Line) => boolean;
}) {
    const analysis = useSession(state => state.analysis);
    const selection = useSession(state => state.selection);
    const { t } = useTranslation('arrange');
    const onsets = useMemo(() => (analysis ? detectOnsets(analysis) : []), [analysis]);
    const units = useMemo(() => lines.map(line => editableUnits(line)), [lines]);
    const from = scrollLeft / zoom - 1;
    const to = (scrollLeft + viewport) / zoom + 1;

    return (
        <>
            {lines.map((line, index) => {
                if (isInterlude(line) || line.endTime < from || line.startTime > to) return null;
                const anchor = anchorOfLine(line, index);
                const limit = {
                    start: index > 0 ? lines[index - 1].startTime + 0.05 : 0,
                    end: index + 1 < lines.length ? lines[index + 1].endTime - 0.05 : Math.max(duration, line.endTime + 5),
                };
                const selected = selection.type === 'line' && selection.lineIndex === index;
                const drag = (event: React.PointerEvent, target: WordDragTarget) => {
                    setSession({ selection: { type: 'line', lineIndex: index } });
                    startWordDrag(event, target, {
                        anchor,
                        line,
                        limit,
                        timeAt,
                        pixelsPerSecond: zoom,
                        snap: true,
                        snapTargets: () => [...onsets, clock.get()].sort((a, b) => a - b),
                    });
                };
                return (
                    <div
                        key={index}
                        data-word-line={index}
                        onPointerDown={event => { event.stopPropagation(); drag(event, { type: 'line-move' }); }}
                        className={cx('absolute top-0.5 bottom-0.5 cursor-grab rounded-sm border border-dashed', selected ? 'border-zinc-200 bg-zinc-500/20' : 'border-zinc-600/80 bg-zinc-800/30')}
                        style={{ left: line.startTime * zoom, width: Math.max(2, (line.endTime - line.startTime) * zoom) }}
                        title={line.fullText}
                    >
                        {units[index].map((unit, unitIndex) => {
                            const left = (unit.startTime - line.startTime) * zoom;
                            const width = (unit.endTime - unit.startTime) * zoom;
                            const label = `${unit.text} · ${formatMs(unit.startTime)} · ${(unit.endTime - unit.startTime).toFixed(3)}s`;
                            if (width < 3) {
                                return <div key={unitIndex} title={label} className="pointer-events-none absolute top-2.5 bottom-1 w-px bg-sky-300/70" style={{ left }} />;
                            }
                            return (
                                <div
                                    key={unitIndex}
                                    data-word-unit={unitIndex}
                                    title={label}
                                    onPointerDown={event => drag(event, { type: 'move', index: unitIndex })}
                                    className="absolute top-2.5 bottom-1 flex cursor-grab items-center justify-center overflow-hidden rounded-[2px] bg-sky-900/60 text-[11px] whitespace-nowrap text-zinc-100 ring-1 ring-sky-700/80 ring-inset"
                                    style={{ left, width }}
                                >
                                    {width >= 14 ? unit.text : ''}
                                    {width >= 8 && (
                                        <>
                                            <div aria-label={t('timeline.wordStart', { text: unit.text })} onPointerDown={event => drag(event, { type: 'edge', index: unitIndex, edge: 'start' })} className="absolute inset-y-0 left-0 w-1 cursor-ew-resize hover:bg-amber-300/70" />
                                            <div aria-label={t('timeline.wordEnd', { text: unit.text })} onPointerDown={event => drag(event, { type: 'edge', index: unitIndex, edge: 'end' })} className="absolute inset-y-0 right-0 w-1 cursor-ew-resize hover:bg-amber-300/70" />
                                        </>
                                    )}
                                </div>
                            );
                        })}
                        <div aria-label={t('timeline.lineStart')} onPointerDown={event => drag(event, { type: 'line', edge: 'start' })} className="absolute inset-y-0 -left-1 z-10 w-1.5 cursor-ew-resize hover:bg-amber-300/70" />
                        <div aria-label={t('timeline.lineEnd')} onPointerDown={event => drag(event, { type: 'line', edge: 'end' })} className="absolute inset-y-0 -right-1 z-10 w-1.5 cursor-ew-resize hover:bg-amber-300/70" />
                    </div>
                );
            })}
        </>
    );
}
