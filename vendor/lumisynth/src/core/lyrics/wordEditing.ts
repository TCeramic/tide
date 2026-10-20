// src/core/lyrics/wordEditing.ts
// 逐字条（歌词面板、时间轴精确模式）上的操作，都是纯函数：输入这一行现在的计时单元与行的边界，
// 返回新的单元与边界（生效时间）。结果交给 project/lyrics.ts 的 setLineWords 存进工程。
// 相邻两个单元首尾相接时，它们之间的「缝」是一起动的；中间有空隙时两边各动各的。
import type { Line } from '@/core/types';
import { splitLyricGraphemes } from './graphemeTiming';
import { MIN_UNIT, normalizeUnits, retimeForText, unitsMatchText, type TimedUnit } from './wordTiming';

export interface Bounds {
    start: number;
    end: number;
}

export interface WordEdit {
    units: TimedUnit[];
    bounds: Bounds;
}

/** 两个单元算「接着」的容差（秒）。 */
const TOUCH = 0.002;

const copy = (units: TimedUnit[]) => units.map(unit => ({ ...unit }));

/**
 * 这一行可以拿来编辑的计时单元：解析出来的逐字拼得回整行就直接用；有的格式拼不回
 * （比如丢了标点），就按字重建一份（时间不变）。
 */
export const editableUnits = (line: Pick<Line, 'fullText' | 'words' | 'startTime' | 'endTime'>): TimedUnit[] => (
    unitsMatchText(line.fullText, line.words)
        ? line.words.map(word => ({ text: word.text, startTime: word.startTime, endTime: word.endTime }))
        : retimeForText(line, line.fullText)
);

const finish = (units: TimedUnit[], bounds: Bounds, limit?: Bounds): WordEdit => {
    const start = Math.max(limit?.start ?? -Infinity, Math.min(bounds.start, units[0]?.startTime ?? bounds.start));
    const end = Math.min(limit?.end ?? Infinity, Math.max(bounds.end, units.at(-1)?.endTime ?? bounds.end));
    return { units: normalizeUnits(units, start, end), bounds: { start, end } };
};

const touching = (units: TimedUnit[], left: number) => (
    left >= 0 && left + 1 < units.length && Math.abs(units[left].endTime - units[left + 1].startTime) < TOUCH
);

export interface DragOptions {
    /** Shift：后面的单元整体跟着移。 */
    ripple?: boolean;
    /** 这一行能占的最大范围（不越过相邻行、歌曲长度）。 */
    limit?: Bounds;
}

/** 拖一个单元的开始或结束到 time。 */
export const dragUnitEdge = (units: TimedUnit[], bounds: Bounds, index: number, edge: 'start' | 'end', time: number, options: DragOptions = {}): WordEdit => {
    const next = copy(units);
    const unit = next[index];
    const limit = options.limit ?? { start: -Infinity, end: Infinity };
    if (edge === 'start') {
        const joined = touching(next, index - 1);
        const previous = next[index - 1];
        const lower = previous ? (joined ? previous.startTime + MIN_UNIT : previous.endTime) : Math.max(limit.start, 0);
        if (options.ripple) {
            const t = Math.max(lower, time);
            const delta = t - unit.startTime;
            for (let i = index; i < next.length; i += 1) {
                next[i].startTime += delta;
                next[i].endTime += delta;
            }
            if (joined) previous.endTime = t;
        } else {
            const t = Math.min(unit.endTime - MIN_UNIT, Math.max(lower, time));
            unit.startTime = t;
            if (joined) previous.endTime = t;
        }
    } else {
        const joined = touching(next, index);
        const following = next[index + 1];
        const lower = unit.startTime + MIN_UNIT;
        if (options.ripple) {
            const t = Math.max(lower, time);
            const delta = t - unit.endTime;
            unit.endTime = t;
            for (let i = index + 1; i < next.length; i += 1) {
                next[i].startTime += delta;
                next[i].endTime += delta;
            }
        } else {
            const upper = following ? (joined ? following.endTime - MIN_UNIT : following.startTime) : limit.end;
            const t = Math.max(lower, Math.min(upper, time));
            unit.endTime = t;
            if (joined) following.startTime = t;
        }
    }
    return finish(next, bounds, options.limit);
};

/** 整块平移一个单元（不越过邻居）；ripple 时它和后面的一起移。 */
export const moveUnit = (units: TimedUnit[], bounds: Bounds, index: number, delta: number, options: DragOptions = {}): WordEdit => {
    const next = copy(units);
    const unit = next[index];
    const previous = next[index - 1];
    const following = next[index + 1];
    const floor = previous ? previous.endTime : Math.max(options.limit?.start ?? -Infinity, 0);
    let shift = Math.max(delta, floor - unit.startTime);
    if (!options.ripple && following) shift = Math.min(shift, following.startTime - unit.endTime);
    if (!options.ripple && !following && options.limit) shift = Math.min(shift, options.limit.end - unit.endTime);
    const last = options.ripple ? next.length : index + 1;
    for (let i = index; i < last; i += 1) {
        next[i].startTime += shift;
        next[i].endTime += shift;
    }
    return finish(next, bounds, options.limit);
};

/** 拖行的开始 / 结束：单元按比例跟着伸缩。 */
export const dragLineEdge = (units: TimedUnit[], bounds: Bounds, edge: 'start' | 'end', time: number, limit?: Bounds): WordEdit => {
    const minSpan = Math.max(0.05, units.length * MIN_UNIT);
    const start = edge === 'start' ? Math.max(limit?.start ?? -Infinity, Math.min(bounds.end - minSpan, time)) : bounds.start;
    const end = edge === 'end' ? Math.min(limit?.end ?? Infinity, Math.max(bounds.start + minSpan, time)) : bounds.end;
    const span0 = Math.max(bounds.end - bounds.start, 1e-6);
    const map = (t: number) => start + ((t - bounds.start) / span0) * (end - start);
    const next = units.map(unit => ({ ...unit, startTime: map(unit.startTime), endTime: map(unit.endTime) }));
    return { units: normalizeUnits(next, start, end), bounds: { start, end } };
};

/** 把一个单元拆成单字（时间均分）。只有一个字时不变。 */
export const splitUnit = (units: TimedUnit[], bounds: Bounds, index: number): WordEdit => {
    const unit = units[index];
    const chars = splitLyricGraphemes(unit.text).filter(char => !/^\s+$/.test(char));
    if (chars.length <= 1) return { units: copy(units), bounds };
    const step = (unit.endTime - unit.startTime) / chars.length;
    const pieces = chars.map((char, i) => ({ text: char, startTime: unit.startTime + step * i, endTime: unit.startTime + step * (i + 1) }));
    return finish([...copy(units.slice(0, index)), ...pieces, ...copy(units.slice(index + 1))], bounds);
};

/** 把一个单元和下一个合并（开始取前一个的，结束取后一个的）。 */
export const mergeWithNext = (units: TimedUnit[], bounds: Bounds, index: number): WordEdit => {
    if (index + 1 >= units.length) return { units: copy(units), bounds };
    const merged = { text: units[index].text + units[index + 1].text, startTime: units[index].startTime, endTime: units[index + 1].endTime };
    return finish([...copy(units.slice(0, index)), merged, ...copy(units.slice(index + 2))], bounds);
};

/** 在行内重新分配：even 每个单元一样长，length 按字数加权。 */
export const distribute = (units: TimedUnit[], bounds: Bounds, mode: 'even' | 'length'): WordEdit => {
    const weights = units.map(unit => (mode === 'even' ? 1 : Math.max(1, splitLyricGraphemes(unit.text.replace(/\s+/g, '')).length)));
    const total = weights.reduce((sum, value) => sum + value, 0) || 1;
    const span = bounds.end - bounds.start;
    let cursor = bounds.start;
    const next = units.map((unit, index) => {
        const duration = (span * weights[index]) / total;
        const item = { text: unit.text, startTime: cursor, endTime: cursor + duration };
        cursor += duration;
        return item;
    });
    return { units: normalizeUnits(next, bounds.start, bounds.end), bounds };
};

/**
 * 打点：taps[k] 是第 k 个单元开始的时刻，最后多出来的一下（如果有）是最后一个单元的结束。
 * 打过点的单元首尾相接；没打到的保留原来的时间。
 */
export const applyTaps = (units: TimedUnit[], bounds: Bounds, taps: number[], limit?: Bounds): WordEdit => {
    const next = copy(units);
    taps.slice(0, next.length).forEach((time, k) => {
        next[k].startTime = time;
        if (k > 0) next[k - 1].endTime = time;
    });
    const tapped = Math.min(taps.length, next.length);
    if (taps.length > next.length) next[next.length - 1].endTime = taps[next.length];
    else if (tapped > 0) {
        // 最后打到的那个单元：保留原来的时长（后面的单元不动，所以不超过下一个的开始）。
        const k = tapped - 1;
        const duration = Math.max(MIN_UNIT, units[k].endTime - units[k].startTime);
        next[k].endTime = Math.min(next[k].startTime + duration, next[k + 1]?.startTime ?? Infinity);
    }
    return finish(next, bounds, limit);
};

/** 整行平移：单元与行的边界一起移 delta 秒，不越出 limit。 */
export const moveLine = (units: TimedUnit[], bounds: Bounds, delta: number, limit?: Bounds): WordEdit => {
    let shift = delta;
    if (limit) shift = Math.max(limit.start - bounds.start, Math.min(limit.end - bounds.end, shift));
    shift = Math.max(-bounds.start, shift);
    return {
        units: units.map(unit => ({ ...unit, startTime: unit.startTime + shift, endTime: unit.endTime + shift })),
        bounds: { start: bounds.start + shift, end: bounds.end + shift },
    };
};
