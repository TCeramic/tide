// src/compiler/structure.ts
// ① Structure：统一分段与全曲性质识别，与任何风格包无关。
import type { Line } from '@/core/types';
import { getLineRenderEndTime } from '@/core/lyrics/renderHints';
import { segmentLyricWords } from '@/core/lyrics/wordSegmentation';
import type { StructureParams } from './params';
import type { ParagraphBoundary, ParagraphKind } from './types';

export interface StructureLine {
    sourceIndex: number;
    line: Line;
    renderEndTime: number;
}

export interface ParagraphDraft<L extends StructureLine = StructureLine> {
    lines: L[];
    boundary: ParagraphBoundary;
    /** 用户合并进来过（不再按上限切开）。 */
    merged?: boolean;
}

/** 用户的分段修改（按源行序号，已校验过锚点）。 */
export interface ManualStructure {
    breaks: Set<number>;
    joins: Set<number>;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const hasLyricText = (line: Line) => /[\p{L}\p{N}]/u.test(line.fullText);

const median = (values: number[]) => {
    if (values.length === 0) return 0.5;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? ((sorted[middle - 1] ?? sorted[middle]) + sorted[middle]) / 2
        : sorted[middle];
};

export const resolveParagraphGapThreshold = (lines: Line[], params: StructureParams) => {
    const gaps = lines.slice(1).map((line, index) => (
        line.startTime - Math.min(getLineRenderEndTime(lines[index]), line.startTime)
    )).filter(gap => gap > 0);
    return clamp(median(gaps) * params.gapMultiplier, params.gapMin, params.gapMax);
};

export const metadataChanged = (previous: Line, next: Line) => (
    (previous.blockIndex !== undefined && next.blockIndex !== undefined && previous.blockIndex !== next.blockIndex)
    || (previous.songPart !== undefined && next.songPart !== undefined && previous.songPart !== next.songPart)
);

/**
 * 超过行数或时长的段落在最大空隙处切开。folia 只继续切右半部分；recursiveSplit 时左半部分也切。
 */
export const splitOversizedDraft = <L extends StructureLine>(draft: ParagraphDraft<L>, params: StructureParams): ParagraphDraft<L>[] => {
    const output: ParagraphDraft<L>[] = [];
    let remaining = draft.lines;
    let boundary = draft.boundary;
    let loopGuard = 0;
    while (remaining.length > params.maxLines || (remaining.length > 1 && (remaining.at(-1)!.renderEndTime - remaining[0].line.startTime) > params.maxDuration)) {
        if (loopGuard++ > 1000) break;
        const candidates = remaining.slice(2, -1).map((line, offset) => ({
            splitIndex: offset + 2,
            gap: line.line.startTime - remaining[offset + 1].renderEndTime,
        }));
        const validCandidates = candidates.filter(candidate => !Number.isNaN(candidate.gap));
        const rawSplitIndex = validCandidates.sort((a, b) => b.gap - a.gap)[0]?.splitIndex ?? Math.min(4, remaining.length - 1);
        const splitIndex = Math.max(1, rawSplitIndex);
        const head: ParagraphDraft<L> = { lines: remaining.slice(0, splitIndex), boundary };
        output.push(...(params.recursiveSplit ? splitOversizedDraft(head, params) : [head]));
        remaining = remaining.slice(splitIndex);
        boundary = output.at(-1)!.lines.length >= params.maxLines ? 'line-cap' : 'duration-cap';
    }
    output.push({ lines: remaining, boundary });
    return output;
};

/**
 * 自动分段 + 用户修改。用户修改都在自动分段（含按上限切开）之后套用，只增删它所在的那一个边界，
 * 不会让别处的自动边界跟着变：break 在那一行把段落切开；join 把以那一行开头的段落并进上一段，
 * 合并结果不再按上限切开——用户的合并优先。兼容模式没有用户修改时与 folia 完全相同。
 */
export const draftParagraphs = <L extends StructureLine>(
    lines: L[],
    threshold: number,
    params: StructureParams,
    manual?: ManualStructure,
): ParagraphDraft<L>[] => {
    const drafts: ParagraphDraft<L>[] = [];
    let current: ParagraphDraft<L> = { lines: [], boundary: 'song-start' };
    lines.forEach((line, index) => {
        const previous = lines[index - 1];
        const gap = previous ? line.line.startTime - previous.renderEndTime : 0;
        const boundary = previous && metadataChanged(previous.line, line.line)
            ? 'metadata'
            : previous && params.inferRepeatedLyrics !== false && hasLyricText(previous.line) !== hasLyricText(line.line)
                ? 'lyric-gap'
                : previous && gap >= threshold
                    ? 'time-gap'
                    : null;
        if (boundary && current.lines.length > 0) {
            drafts.push(...splitOversizedDraft(current, params));
            current = { lines: [], boundary };
        }
        current.lines.push(line);
    });
    if (current.lines.length > 0) drafts.push(...splitOversizedDraft(current, params));
    if (!manual || (manual.breaks.size === 0 && manual.joins.size === 0)) return drafts;
    const broken = drafts.flatMap(draft => {
        const pieces: ParagraphDraft<L>[] = [{ lines: [], boundary: draft.boundary }];
        draft.lines.forEach((line, index) => {
            if (index > 0 && manual.breaks.has(line.sourceIndex)) pieces.push({ lines: [], boundary: 'manual' });
            pieces.at(-1)!.lines.push(line);
        });
        return pieces;
    });
    const joined: ParagraphDraft<L>[] = [];
    broken.forEach(draft => {
        const previous = joined.at(-1);
        if (previous && manual.joins.has(draft.lines[0].sourceIndex)) {
            previous.lines = [...previous.lines, ...draft.lines];
            previous.merged = true;
        } else {
            joined.push({ ...draft });
        }
    });
    return joined;
};

/** 一行里「像词」的片段数（与两包粘连标点之后的计数相同：粘连只合并非词片段）。 */
export const countWordLike = (line: Line) => segmentLyricWords(line).filter(part => part.isWordLike).length;

export const classifyParagraph = (lines: StructureLine[], index: number, total: number): ParagraphKind => {
    if (lines.some(item => item.line.isChorus || /chorus|副歌/i.test(item.line.songPart ?? ''))) return 'chorus';
    if (lines.some(item => /bridge|break|間奏|ブリッジ/i.test(item.line.songPart ?? ''))) return 'break';
    if (index === total - 1) return 'outro';
    const duration = lines.at(-1)!.renderEndTime - lines[0].line.startTime;
    const segmentCount = lines.reduce((sum, line) => sum + countWordLike(line.line), 0);
    const punctuationCount = lines.reduce((sum, line) => sum + (line.line.fullText.match(/[!?！？…]/g)?.length ?? 0), 0);
    if (duration <= 3.5 || segmentCount <= 3) return 'breath';
    if (punctuationCount >= 2 || segmentCount / Math.max(duration, 1) > 2.5) return 'lift';
    return 'verse';
};

/** 只比较主歌词；译文、罗马音、计时和分词方式不影响重复识别。 */
const normalizedLyrics = (lines: StructureLine[]) => lines
    .map(({ line }) => line.fullText.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, ''))
    .filter(text => /[\p{L}\p{N}]/u.test(text));

const REPEAT_SIMILARITY = 0.75;

interface LyricComparison {
    similarity: number;
    distinctMatches: number;
}

/** 按行序做 LCS，允许少量增删行，但共享一行或重复口号不足以成为副歌。 */
const compareLyrics = (left: string[], right: string[]): LyricComparison => {
    let previous = new Array<number>(right.length + 1).fill(0);
    for (const text of left) {
        const current = new Array<number>(right.length + 1).fill(0);
        for (let j = 0; j < right.length; j += 1) {
            current[j + 1] = text === right[j]
                ? previous[j] + 1
                : Math.max(previous[j + 1], current[j]);
        }
        previous = current;
    }
    const rightTexts = new Set(right);
    return {
        similarity: previous[right.length] / Math.max(left.length, right.length, 1),
        distinctMatches: new Set(left.filter(text => rightTexts.has(text))).size,
    };
};

/**
 * 先保留单段规则与手动性质，再用全曲重复补没有标注的段落。
 * 上限切分只为镜头编排服务：识别时临时合回原段，结果仍按原 drafts 返回。
 * kindOverrides 按源行序号锚定，与编译器的手动性质修改一致。
 */
export const classifyParagraphs = (
    drafts: ParagraphDraft[],
    kindOverrides: ReadonlyMap<number, ParagraphKind> = new Map(),
): ParagraphKind[] => {
    const kinds = drafts.map((draft, index) => kindOverrides.get(draft.lines[0].sourceIndex)
        ?? classifyParagraph(draft.lines, index, drafts.length));
    const sections: { paragraphs: number[]; lines: StructureLine[] }[] = [];
    drafts.forEach((draft, index) => {
        const previous = sections.at(-1);
        if (previous && (draft.boundary === 'line-cap' || draft.boundary === 'duration-cap')) {
            previous.paragraphs.push(index);
            previous.lines.push(...draft.lines);
        } else {
            sections.push({ paragraphs: [index], lines: [...draft.lines] });
        }
    });
    const profiles = sections.map(section => {
        const text = normalizedLyrics(section.lines);
        return {
            ...section,
            text,
            unmarked: section.paragraphs.every(index => !kindOverrides.has(drafts[index].lines[0].sourceIndex))
                && !section.lines.some(({ line }) => line.isChorus || line.songPart?.trim()),
            substantive: section.lines.at(-1)!.renderEndTime - section.lines[0].line.startTime > 3.5
                && section.lines.reduce((sum, { line }) => sum + countWordLike(line), 0) > 3,
        };
    });
    // 每对只算一次，之后聚组和前置段判断共享比较结果。
    const comparisons: LyricComparison[][] = profiles.map(() => []);
    profiles.forEach((left, i) => {
        for (let j = i; j < profiles.length; j += 1) {
            const comparison = compareLyrics(left.text, profiles[j].text);
            comparisons[i][j] = comparison;
            comparisons[j][i] = comparison;
        }
    });
    const matches = (a: number, b: number) => comparisons[a][b].similarity >= REPEAT_SIMILARITY
        && comparisons[a][b].distinctMatches >= 2;
    const candidates = profiles.flatMap((profile, index) => (
        profile.unmarked && profile.substantive && new Set(profile.text).size >= 2 ? [index] : []
    ));
    const markedChorus = profiles.flatMap((profile, index) => (
        profile.paragraphs.some(paragraph => kinds[paragraph] === 'chorus') ? [index] : []
    ));
    let inferredChorus: number[];
    if (markedChorus.length > 0) {
        // 有显式副歌时只补与它重复的无标注段，避免把重复主歌另判成副歌。
        inferredChorus = candidates.filter(index => markedChorus.some(other => matches(index, other)));
    } else {
        const groups: number[][] = [];
        for (const index of candidates) {
            // 所有成员两两匹配，防止 A≈B、B≈C 把并不相似的 A、C 串在一起。
            const group = groups.find(items => items.every(other => matches(index, other)));
            if (group) group.push(index);
            else groups.push([index]);
        }
        // 紧邻的连续重复算同一次出现；副歌需要在歌曲不同位置再次出现。
        const occurrences = (group: number[]) => group.filter((index, slot) => slot === 0 || index > group[slot - 1] + 1).length;
        const repeated = groups.filter(group => occurrences(group) >= 2);
        // 重复次数优先；同频时选歌词更完整的组，再按首次出现顺序稳定决胜。
        const length = (group: number[]) => Math.max(...group.map(index => profiles[index].text.join('').length));
        repeated.sort((a, b) => occurrences(b) - occurrences(a) || length(b) - length(a) || a[0] - b[0]);
        inferredChorus = repeated[0] ?? [];
    }
    for (const index of inferredChorus) {
        for (const paragraph of profiles[index].paragraphs) kinds[paragraph] = 'chorus';
    }
    for (const index of [...markedChorus, ...inferredChorus]) {
        const previous = profiles[index - 1];
        if (!previous?.unmarked || !previous.substantive || previous.text.length === 0) continue;
        if (previous.paragraphs.some(paragraph => kinds[paragraph] === 'chorus')) continue;
        const unique = comparisons[index - 1].every((comparison, other) => (
            other === index - 1 || comparison.similarity < REPEAT_SIMILARITY
        ));
        if (unique) {
            for (const paragraph of previous.paragraphs) kinds[paragraph] = 'lift';
        }
    }
    return kinds;
};
