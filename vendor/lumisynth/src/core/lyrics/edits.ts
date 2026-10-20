// src/core/lyrics/edits.ts
// 在编译前作用于 LyricData 的用户修改：整体偏移、逐行修改（改字、改译文、行时间、逐字时间）、手动分词。
// 每条修改都按歌词文件里的「行序号 + 原文哈希」锚定：换了歌词文件、行对不上时修改失效并列出来，
// 而不是悄悄套到另一行上。改字不改锚点——生效后的行带着原文哈希（sourceHash），所有锚点都按它算。
import type { Line, LyricData, Word } from '@/core/types';
import { isValidWordSegmentation } from './wordSegmentation';
import { annotateLyricLines } from './renderHints';
import { normalizeUnits, retimeForText, unitsMatchText, type TimedUnit } from './wordTiming';

/** FNV-1a，32 位，十六进制。行文本哈希与项目里其他锚点共用。 */
export const hashText = (text: string): string => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

export interface LineAnchor {
    index: number;
    hash: string;
}

export const anchorOfLine = (line: Pick<Line, 'fullText' | 'sourceHash'>, index: number): LineAnchor => ({ index, hash: line.sourceHash ?? hashText(line.fullText) });
export const anchorKey = (anchor: LineAnchor) => `${anchor.index}:${anchor.hash}`;

export const resolveLineAnchor = (lines: Line[], anchor: LineAnchor): number | null => (
    lines[anchor.index] && hashText(lines[anchor.index].fullText) === anchor.hash ? anchor.index : null
);

/**
 * 一行的修改。时间都是歌词文件的时间（不含整体偏移）。
 * - 只有 startTime / endTime：整行拖动 / 拖两端，逐字时间按比例跟着伸缩；
 * - 有 words：逐字时间是明确给出的（手动调过，或者改字时算好的），行的开始 / 结束只作为边界；
 * - text：改过的文字。没有 words 时逐字时间按「没变的字保留时间」从原来的行推出来；
 * - translation：改过的译文（字幕）。空字符串表示这一行不显示译文。
 */
export interface LineEdit {
    anchor: LineAnchor;
    text?: string;
    translation?: string;
    startTime?: number;
    endTime?: number;
    words?: TimedUnit[];
}

export interface LyricEdits {
    /** 秒；正值表示歌词整体推迟。 */
    offset: number;
    lines: LineEdit[];
    /** 手动分词：join('') 必须等于该行（改字之后的）fullText，否则失效，等待修复。 */
    segments: Array<{ anchor: LineAnchor; parts: string[] }>;
}

export const EMPTY_LYRIC_EDITS: LyricEdits = { offset: 0, lines: [], segments: [] };

export interface InvalidEdit {
    kind: 'line' | 'segments';
    anchor: LineAnchor;
    /** invalid-segmentation：分词拼不回这一行现在的文字（多半是改了字），可以自动修复。 */
    reason: 'line-missing' | 'text-changed' | 'invalid-segmentation';
}

const shiftWord = (word: Word, delta: number): Word => ({
    ...word,
    startTime: word.startTime + delta,
    endTime: word.endTime + delta,
    syllables: word.syllables?.map(s => ({ ...s, startTime: s.startTime + delta, endTime: s.endTime + delta })),
});

const shiftLine = (line: Line, delta: number): Line => delta === 0 ? line : ({
    ...line,
    startTime: line.startTime + delta,
    endTime: line.endTime + delta,
    words: line.words.map(word => shiftWord(word, delta)),
    backgroundVocal: line.backgroundVocal && {
        ...line.backgroundVocal,
        startTime: line.backgroundVocal.startTime + delta,
        endTime: line.backgroundVocal.endTime + delta,
        words: line.backgroundVocal.words.map(word => shiftWord(word, delta)),
    },
    backgroundVocals: line.backgroundVocals?.map(vocal => ({
        ...vocal,
        startTime: vocal.startTime + delta,
        endTime: vocal.endTime + delta,
        words: vocal.words.map(word => shiftWord(word, delta)),
    })),
});

/** 把一行的时间从 [s0, e0] 线性映射到 [s1, e1]，行内逐字时间按比例跟随。 */
const retimeLine = (line: Line, startTime: number, endTime: number): Line => {
    const s0 = line.startTime;
    const span0 = Math.max(line.endTime - s0, 1e-6);
    const span1 = Math.max(endTime - startTime, 0.05);
    const map = (t: number) => startTime + ((t - s0) / span0) * span1;
    const mapWord = (word: Word): Word => ({
        ...word,
        startTime: map(word.startTime),
        endTime: map(word.endTime),
        syllables: word.syllables?.map(s => ({ ...s, startTime: map(s.startTime), endTime: map(s.endTime) })),
    });
    return {
        ...line,
        startTime,
        endTime: startTime + span1,
        words: line.words.map(mapWord),
        backgroundVocal: line.backgroundVocal && {
            ...line.backgroundVocal,
            startTime: map(line.backgroundVocal.startTime),
            endTime: map(line.backgroundVocal.endTime),
            words: line.backgroundVocal.words.map(mapWord),
        },
        backgroundVocals: line.backgroundVocals?.map(vocal => ({
            ...vocal,
            startTime: map(vocal.startTime),
            endTime: map(vocal.endTime),
            words: vocal.words.map(mapWord),
        })),
    };
};

export interface AppliedLyricEdits {
    data: LyricData;
    invalid: InvalidEdit[];
}

const asWords = (units: TimedUnit[]): Word[] => units.map(unit => ({ text: unit.text, startTime: unit.startTime, endTime: unit.endTime }));

/** 把一条行修改套到原来的行上（都是歌词文件的时间）。 */
export const applyLineEdit = (line: Line, edit: LineEdit): Line => {
    let next = edit.translation === undefined ? line : { ...line, translation: edit.translation || undefined };
    const text = edit.text ?? line.fullText;
    const explicit = edit.words && unitsMatchText(text, edit.words) ? edit.words : null;
    if (text !== line.fullText) {
        next = { ...next, fullText: text, words: asWords(explicit ?? retimeForText(line, text)) };
    } else if (explicit) {
        next = { ...next, words: asWords(explicit) };
    }
    if (edit.startTime === undefined && edit.endTime === undefined) {
        return explicit ? { ...next, words: asWords(normalizeUnits(explicit, next.startTime, next.endTime)) } : next;
    }
    const startTime = edit.startTime ?? next.startTime;
    const endTime = edit.endTime ?? next.endTime + (startTime - next.startTime);
    if (explicit) {
        return { ...next, startTime, endTime, words: asWords(normalizeUnits(explicit, startTime, endTime)) };
    }
    return retimeLine(next, startTime, endTime);
};

export const applyLyricEdits = (source: LyricData, edits: LyricEdits): AppliedLyricEdits => {
    const invalid: InvalidEdit[] = [];
    // 锚点对照的是歌词文件（偏移前）的原文，这样整体偏移与改字都不会让手动修改失效。
    let lines: Line[] = source.lines.map(line => ({ ...line, sourceHash: hashText(line.fullText) }));

    const check = (kind: InvalidEdit['kind'], anchor: LineAnchor) => {
        const line = source.lines[anchor.index];
        if (!line) {
            invalid.push({ kind, anchor, reason: 'line-missing' });
            return false;
        }
        if (hashText(line.fullText) !== anchor.hash) {
            invalid.push({ kind, anchor, reason: 'text-changed' });
            return false;
        }
        return true;
    };

    for (const edit of edits.lines) {
        if (!check('line', edit.anchor)) continue;
        lines[edit.anchor.index] = applyLineEdit(lines[edit.anchor.index], edit);
    }

    // 分词对照的是改字之后的文字。
    for (const edit of edits.segments) {
        if (!check('segments', edit.anchor)) continue;
        const line = lines[edit.anchor.index];
        if (!isValidWordSegmentation(line.fullText, edit.parts)) {
            invalid.push({ kind: 'segments', anchor: edit.anchor, reason: 'invalid-segmentation' });
            continue;
        }
        lines[edit.anchor.index] = { ...line, wordSegments: [...edit.parts] };
    }

    if (edits.offset !== 0) lines = lines.map(line => shiftLine(line, edits.offset));
    // 不重排：行序号就是锚点，编辑界面负责不让一行越过相邻行。渲染提示依赖相邻行的时间，要重算。
    if (edits.lines.length > 0 || edits.offset !== 0) {
        lines = annotateLyricLines(lines.map(line => ({ ...line, renderHints: undefined })));
    }
    return { data: { ...source, lines }, invalid };
};
