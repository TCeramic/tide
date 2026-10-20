// src/app/lyrics/wordDrag.ts
// 逐字条的拖动（歌词面板与时间轴精确模式共用）：拖单元的开始 / 结束、整块拖、拖行的两端。
// 每次移动都从按下那一刻的快照重新算，所以一次拖动的结果与中间经过的位置无关；一次拖动合并成一步撤销。
// 吸附：起音点与播放头，屏幕上 6px 以内；按住 Alt 不吸附。Shift：后面的单元跟着一起移。
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { LineAnchor } from '@/core/lyrics/edits';
import { nearestTime } from '@/core/audio/onsets';
import { dragLineEdge, dragUnitEdge, editableUnits, moveLine, moveUnit, type Bounds, type WordEdit } from '@/core/lyrics/wordEditing';
import type { Line } from '@/core/types';
import { setLineWords } from '@/project/lyrics';

export type WordDragTarget =
    | { type: 'edge'; index: number; edge: 'start' | 'end' }
    | { type: 'move'; index: number }
    | { type: 'line'; edge: 'start' | 'end' }
    /** 整行平移。 */
    | { type: 'line-move' };

export interface WordDragContext {
    anchor: LineAnchor;
    /** 生效后的行（按下时的样子）。 */
    line: Line;
    /** 这一行能占的范围（不越过相邻行）。 */
    limit: Bounds;
    /** 屏幕横坐标 → 时刻。 */
    timeAt: (clientX: number) => number;
    pixelsPerSecond: number;
    /** 吸附目标（升序）。snap 为 false 时不吸附。 */
    snapTargets: () => number[];
    snap: boolean;
    onDragStart?: () => void;
    onDragEnd?: () => void;
    /** 按下又松开、什么都没改（点了一下）时调用。 */
    onTap?: (time: number) => void;
}

const SNAP_PX = 6;

let dragCounter = 0;

/** 按一个拖动目标算出新的单元与边界。 */
export const resolveWordDrag = (
    target: WordDragTarget,
    units: ReturnType<typeof editableUnits>,
    bounds: Bounds,
    origin: number,
    time: number,
    ripple: boolean,
    limit: Bounds,
): WordEdit => {
    if (target.type === 'edge') return dragUnitEdge(units, bounds, target.index, target.edge, time, { ripple, limit });
    if (target.type === 'move') return moveUnit(units, bounds, target.index, time - origin, { ripple, limit });
    if (target.type === 'line-move') return moveLine(units, bounds, time - origin, limit);
    return dragLineEdge(units, bounds, target.edge, time, limit);
};

export const startWordDrag = (event: ReactPointerEvent, target: WordDragTarget, context: WordDragContext) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    const units = editableUnits(context.line);
    const bounds = { start: context.line.startTime, end: context.line.endTime };
    const key = `drag-${(dragCounter += 1)}`;
    const tolerance = SNAP_PX / Math.max(1, context.pixelsPerSecond);
    const targets = context.snapTargets();
    // 整块 / 整行拖时吸附的是单元 / 行的开始；其余吸附的是指针下的时刻。
    const anchorTime = target.type === 'move' ? units[target.index].startTime : target.type === 'line-move' ? bounds.start : null;
    const origin = context.timeAt(event.clientX);
    // 只在结果变了时写入：原地按一下、被邻居夹住拖不动，都不产生修改。
    const signature = (edit: WordEdit) => `${edit.bounds.start.toFixed(5)},${edit.bounds.end.toFixed(5)};${edit.units.map(unit => `${unit.startTime.toFixed(5)}-${unit.endTime.toFixed(5)}`).join(',')}`;
    const initial = signature({ units, bounds });
    let applied = initial;
    context.onDragStart?.();
    const move = (moveEvent: PointerEvent) => {
        let time = context.timeAt(moveEvent.clientX);
        if (context.snap && !moveEvent.altKey) {
            if (anchorTime !== null) {
                const snapped = nearestTime(targets, anchorTime + time - origin, tolerance);
                if (snapped !== null) time = snapped - anchorTime + origin;
            } else {
                time = nearestTime(targets, time, tolerance) ?? time;
            }
        }
        const result = resolveWordDrag(target, units, bounds, origin, time, moveEvent.shiftKey, context.limit);
        const next = signature(result);
        if (next === applied) return;
        applied = next;
        setLineWords(context.anchor, context.line, result.units, { startTime: result.bounds.start, endTime: result.bounds.end }, key);
    };
    const up = (upEvent: PointerEvent) => {
        element.removeEventListener('pointermove', move);
        element.removeEventListener('pointerup', up);
        element.removeEventListener('pointercancel', up);
        context.onDragEnd?.();
        if (applied === initial && upEvent.type === 'pointerup') context.onTap?.(context.timeAt(upEvent.clientX));
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
};
