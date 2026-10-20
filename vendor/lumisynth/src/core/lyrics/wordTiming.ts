// src/core/lyrics/wordTiming.ts
// 逐字时间的编辑规则（歌词面板、时间轴精确模式、剧本、agent 共用）：
// - 计时单元：CJK / 假名 / 谚文每字一个，其余按空白分词（与解析逐行歌词时的 buildTimedWords 一致），空白不算；
// - 改字：按字对齐新旧文本，没变的字保留原来的时间，新写的字均分空出来的那一段；
// - 整理：单调、不重叠、每个单元至少 MIN_UNIT 秒、落在行内。
import type { Line } from '@/core/types';
import { buildLineGraphemeTimeline, splitLyricGraphemes } from './graphemeTiming';

export interface TimedUnit {
    text: string;
    startTime: number;
    endTime: number;
}

/** 一个计时单元最短多长（秒）。 */
export const MIN_UNIT = 0.03;

const PER_CHARACTER = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;
const WHITESPACE = /^\s+$/;

/** 文本切成计时单元（不带时间）。 */
export const timingUnitTexts = (text: string): string[] => text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap(token => (PER_CHARACTER.test(token) ? splitLyricGraphemes(token) : [token]));

const compact = (text: string) => text.replace(/\s+/g, '');

/** 单元拼起来（不计空白）是不是这段文字。 */
export const unitsMatchText = (text: string, units: Array<{ text: string }>) => (
    units.length > 0 && compact(units.map(unit => unit.text).join('')) === compact(text)
);

/** 在 [start, end] 里按字数均分（没有时间信息时的起点）。 */
export const evenUnits = (text: string, start: number, end: number): TimedUnit[] => {
    const texts = timingUnitTexts(text);
    const weights = texts.map(item => splitLyricGraphemes(item).length);
    const total = Math.max(1, weights.reduce((sum, value) => sum + value, 0));
    const span = Math.max(end - start, 0);
    let cursor = start;
    return texts.map((item, index) => {
        const duration = (span * weights[index]) / total;
        const unit = { text: item, startTime: cursor, endTime: index === texts.length - 1 ? end : cursor + duration };
        cursor += duration;
        return unit;
    });
};

/**
 * 让单元单调、不重叠、每个至少 MIN_UNIT、落在 [start, end] 里。放不下时按字数均分。
 * 已经合规的单元原样返回（时间不动）。
 */
export const normalizeUnits = (units: TimedUnit[], start: number, end: number): TimedUnit[] => {
    if (units.length === 0) return [];
    const span = end - start;
    if (span < units.length * MIN_UNIT) {
        const step = Math.max(span, 0) / units.length;
        return units.map((unit, index) => ({ ...unit, startTime: start + step * index, endTime: start + step * (index + 1) }));
    }
    const next = units.map(unit => ({ ...unit }));
    // 往后推：不早于行首、不早于上一个的结束，至少 MIN_UNIT。
    let floor = start;
    next.forEach(unit => {
        unit.startTime = Math.max(unit.startTime, floor);
        unit.endTime = Math.max(unit.endTime, unit.startTime + MIN_UNIT);
        floor = unit.endTime;
    });
    // 往前收：不晚于行尾、不晚于下一个的开始。
    let ceiling = end;
    for (let i = next.length - 1; i >= 0; i -= 1) {
        const unit = next[i];
        unit.endTime = Math.min(unit.endTime, ceiling);
        unit.startTime = Math.min(unit.startTime, unit.endTime - MIN_UNIT);
        ceiling = unit.startTime;
    }
    return next;
};

/** 按字的最长公共子序列：返回 new 下标 → old 下标（没对上为 -1）。 */
const alignGraphemes = (before: string[], after: string[]) => {
    const rows = before.length + 1;
    const cols = after.length + 1;
    const table = new Uint16Array(rows * cols);
    for (let i = before.length - 1; i >= 0; i -= 1) {
        for (let j = after.length - 1; j >= 0; j -= 1) {
            table[i * cols + j] = before[i] === after[j]
                ? table[(i + 1) * cols + j + 1] + 1
                : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
        }
    }
    const match = new Array<number>(after.length).fill(-1);
    let i = 0;
    let j = 0;
    while (i < before.length && j < after.length) {
        if (before[i] === after[j]) {
            match[j] = i;
            i += 1;
            j += 1;
        } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
            i += 1;
        } else {
            j += 1;
        }
    }
    return match;
};

/**
 * 改字后的计时单元：line 是改之前的行（带逐字时间），text 是新文字。
 * 没变的字保留时间；新写的字均分前后两个保留的字之间的时间段（在行首 / 行尾时以行的边界为界）。
 */
export const retimeForText = (line: Pick<Line, 'fullText' | 'words' | 'startTime' | 'endTime'>, text: string): TimedUnit[] => {
    const before = buildLineGraphemeTimeline(line as Line).filter(item => !WHITESPACE.test(item.char));
    const after = splitLyricGraphemes(text).filter(char => !WHITESPACE.test(char));
    if (after.length === 0) return [];
    const match = alignGraphemes(before.map(item => item.char), after);
    const times: Array<{ startTime: number; endTime: number }> = new Array(after.length);
    match.forEach((oldIndex, newIndex) => {
        if (oldIndex >= 0) times[newIndex] = { startTime: before[oldIndex].startTime, endTime: before[oldIndex].endTime };
    });
    for (let j = 0; j < after.length;) {
        if (times[j]) {
            j += 1;
            continue;
        }
        let k = j;
        while (k < after.length && !times[k]) k += 1;
        const from = j > 0 ? times[j - 1].endTime : line.startTime;
        const to = k < after.length ? times[k].startTime : line.endTime;
        const step = Math.max(to - from, 0) / (k - j);
        for (let n = j; n < k; n += 1) times[n] = { startTime: from + step * (n - j), endTime: from + step * (n - j + 1) };
        j = k;
    }
    // 字 → 计时单元：单元的时间是它第一个字的开始到最后一个字的结束。
    let cursor = 0;
    const units = timingUnitTexts(text).map(unitText => {
        const count = splitLyricGraphemes(unitText).filter(char => !WHITESPACE.test(char)).length;
        const first = times[cursor];
        const last = times[Math.min(cursor + count, times.length) - 1];
        cursor += count;
        return { text: unitText, startTime: first.startTime, endTime: last.endTime };
    });
    return normalizeUnits(units, line.startTime, line.endTime);
};

/** 行的开始 / 结束改了：单元按比例跟着伸缩。 */
export const scaleUnits = (units: TimedUnit[], from: { start: number; end: number }, to: { start: number; end: number }): TimedUnit[] => {
    const span0 = Math.max(from.end - from.start, 1e-6);
    const span1 = Math.max(to.end - to.start, 0);
    const map = (time: number) => to.start + ((time - from.start) / span0) * span1;
    return normalizeUnits(units.map(unit => ({ ...unit, startTime: map(unit.startTime), endTime: map(unit.endTime) })), to.start, to.end);
};
