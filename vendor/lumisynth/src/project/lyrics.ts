// src/project/lyrics.ts
// 歌词的编辑动作：整体偏移、行的开始 / 结束、改字、改译文、逐字时间、手动分词（含改字后的自动修复）。
// 传进来的 current 是生效后的行（含整体偏移，界面上看到的就是它），存进工程的是歌词文件的时间。
// with* 是纯函数（剧本、agent 也用），其余是进撤销栈的动作。
import type { LineAnchor, LineEdit } from '@/core/lyrics/edits';
import type { Line } from '@/core/types';
import { repairWordSegmentation } from '@/core/lyrics/wordSegmentation';
import { normalizeUnits, retimeForText, scaleUnits, unitsMatchText, type TimedUnit } from '@/core/lyrics/wordTiming';
import { updateProject } from './store';
import type { LumiProject } from './types';

const sameLine = (a: LineAnchor, b: LineAnchor) => a.index === b.index && a.hash === b.hash;

export const lineEditOf = (project: LumiProject, anchor: LineAnchor) => project.lyricEdits.lines.find(item => sameLine(item.anchor, anchor));

const isEmpty = (edit: LineEdit) => edit.text === undefined && edit.translation === undefined
    && edit.startTime === undefined && edit.endTime === undefined && edit.words === undefined;

/** 两条修改的内容相同（不计键的顺序与值为 undefined 的键）。 */
const sameEdit = (a: LineEdit | null | undefined, b: LineEdit | null | undefined) => {
    if (!a || !b) return !a && !b;
    const canonical = (edit: LineEdit) => JSON.stringify(Object.entries(edit).filter(([, value]) => value !== undefined).sort(([x], [y]) => x.localeCompare(y)));
    return canonical(a) === canonical(b);
};

/** 改写一行的修改；recipe 返回 null 或空修改时删掉这一条；修改没有变化时返回原来的工程。 */
const withLineEdit = (project: LumiProject, anchor: LineAnchor, recipe: (existing: LineEdit | undefined) => LineEdit | null): LumiProject => {
    const existing = lineEditOf(project, anchor);
    const next = recipe(existing);
    const others = project.lyricEdits.lines.filter(item => !sameLine(item.anchor, anchor));
    const kept = next && !isEmpty(next) ? { ...next, anchor } : null;
    if (sameEdit(kept, existing)) return project;
    const lines = kept ? [...others, kept] : others;
    return { ...project, lyricEdits: { ...project.lyricEdits, lines } };
};

const shift = (units: TimedUnit[], delta: number): TimedUnit[] => units.map(unit => ({ text: unit.text, startTime: unit.startTime + delta, endTime: unit.endTime + delta }));

/** 生效的行里的逐字时间（去掉整体偏移，是歌词文件的时间）。 */
const fileUnits = (project: LumiProject, current: Line) => shift(current.words.map(word => ({ text: word.text, startTime: word.startTime, endTime: word.endTime })), -project.lyricEdits.offset);

/** 这一行的逐字时间是不是明确给出的（手动调过或改过字）。 */
export const hasExplicitWords = (project: LumiProject, anchor: LineAnchor) => Boolean(lineEditOf(project, anchor)?.words);

// ---------------------------------------------------------------------------------------------
// 纯函数

/** 整体偏移（秒，正值推迟）。 */
export const withLyricOffset = (project: LumiProject, offset: number): LumiProject => ({ ...project, lyricEdits: { ...project.lyricEdits, offset } });

/** 行的开始 / 结束（生效时间）。逐字时间明确给出过的，按比例跟着伸缩。 */
export const withLineBounds = (project: LumiProject, anchor: LineAnchor, current: Line, bounds: { startTime?: number; endTime?: number }): LumiProject => {
    const offset = project.lyricEdits.offset;
    const from = { start: current.startTime - offset, end: current.endTime - offset };
    const start = (bounds.startTime ?? current.startTime) - offset;
    const end = Math.max(start + 0.05, (bounds.endTime ?? current.endTime) - offset);
    return withLineEdit(project, anchor, existing => (existing?.words
        ? { ...existing, anchor, startTime: start, endTime: end, words: scaleUnits(fileUnits(project, current), from, { start, end }) }
        : { ...existing, anchor, startTime: start, endTime: end }));
};

/** 改字：没变的字保留原来的时间，新写的字均分空出来的时间段。文字没变时不改。 */
export const withLineText = (project: LumiProject, anchor: LineAnchor, current: Line, text: string): LumiProject => {
    const clean = text.replace(/[\r\n]+/g, ' ');
    if (!clean.trim() || clean === current.fullText) return project;
    const offset = project.lyricEdits.offset;
    const words = shift(retimeForText(current, clean), -offset);
    return withLineEdit(project, anchor, existing => ({
        ...existing,
        anchor,
        text: clean,
        words,
        startTime: current.startTime - offset,
        endTime: current.endTime - offset,
    }));
};

/**
 * 改译文（字幕）：空字符串表示这一行不显示译文；与歌词文件里的译文相同时去掉这条修改。
 * original 是歌词文件里这一行的译文。
 */
export const withLineTranslation = (project: LumiProject, anchor: LineAnchor, translation: string, original: string | undefined): LumiProject => {
    const clean = translation.replace(/[\r\n]+/g, ' ').trim();
    return withLineEdit(project, anchor, existing => {
        const { translation: _previous, ...rest } = existing ?? { anchor };
        return clean === (original ?? '').trim() ? { ...rest, anchor } : { ...rest, anchor, translation: clean };
    });
};

/**
 * 逐字时间（生效时间）。单元的文字必须拼得回这一行的文字（不计空白）；bounds 不给时沿用行现在的开始 / 结束。
 * 返回 null 表示单元对不上文字。
 */
export const withLineWords = (
    project: LumiProject,
    anchor: LineAnchor,
    current: Line,
    words: TimedUnit[],
    bounds?: { startTime: number; endTime: number },
): LumiProject | null => {
    if (!unitsMatchText(current.fullText, words)) return null;
    const offset = project.lyricEdits.offset;
    const startTime = (bounds?.startTime ?? current.startTime) - offset;
    const endTime = (bounds?.endTime ?? current.endTime) - offset;
    const normalized = normalizeUnits(shift(words, -offset), startTime, endTime);
    return withLineEdit(project, anchor, existing => ({ ...existing, anchor, startTime, endTime, words: normalized }));
};

const keptTranslation = (edit: LineEdit) => (edit.translation !== undefined ? { translation: edit.translation } : {});

/** 恢复原始时间（保留改过的字与译文；逐字时间重新从原来的行推出来）。 */
export const withoutLineTiming = (project: LumiProject, anchor: LineAnchor): LumiProject => withLineEdit(project, anchor, existing => (
    existing ? { anchor, ...(existing.text !== undefined ? { text: existing.text } : {}), ...keptTranslation(existing) } : null
));

/** 恢复原文（保留行的开始 / 结束与改过的译文；逐字时间随原文恢复）。 */
export const withoutLineText = (project: LumiProject, anchor: LineAnchor): LumiProject => withLineEdit(project, anchor, existing => (
    existing ? { anchor, startTime: existing.startTime, endTime: existing.endTime, ...keptTranslation(existing) } : null
));

/** 恢复歌词文件里的译文。 */
export const withoutLineTranslation = (project: LumiProject, anchor: LineAnchor): LumiProject => withLineEdit(project, anchor, existing => {
    if (!existing) return null;
    const { translation: _translation, ...rest } = existing;
    return rest;
});

/** 这一行的修改全部去掉。 */
export const withoutLineEdit = (project: LumiProject, anchor: LineAnchor): LumiProject => withLineEdit(project, anchor, () => null);

export const withLineSegments = (project: LumiProject, anchor: LineAnchor, parts: string[] | null): LumiProject => {
    const others = project.lyricEdits.segments.filter(item => !sameLine(item.anchor, anchor));
    return { ...project, lyricEdits: { ...project.lyricEdits, segments: parts ? [...others, { anchor, parts }] : others } };
};

/** 手动分词拼不回现在的文字时的修复结果（不需要修复时为 null）。 */
export const segmentationRepairFor = (project: LumiProject, anchor: LineAnchor, current: Line): string[] | null => {
    const saved = project.lyricEdits.segments.find(item => sameLine(item.anchor, anchor));
    if (!saved || saved.parts.join('') === current.fullText) return null;
    return repairWordSegmentation(saved.parts, current.fullText);
};

/** 自动修复手动分词：改动以外的分隔照旧，改动的那一段重新分。 */
export const withRepairedSegmentation = (project: LumiProject, anchor: LineAnchor, current: Line): LumiProject => {
    const repaired = segmentationRepairFor(project, anchor, current);
    return repaired ? withLineSegments(project, anchor, repaired) : project;
};

// ---------------------------------------------------------------------------------------------
// 动作（进撤销栈）

export const setLyricOffset = (offset: number) => updateProject(project => withLyricOffset(project, offset), { coalesce: 'lyric-offset' });

/** 拖行的两端 / 在检查器里改时间。连续拖动合并成一步撤销。 */
export const setLineBounds = (anchor: LineAnchor, current: Line, bounds: { startTime?: number; endTime?: number }) => updateProject(
    project => withLineBounds(project, anchor, current, bounds),
    { coalesce: `line-bounds:${anchor.index}` },
);

export const setLineText = (anchor: LineAnchor, current: Line, text: string) => updateProject(project => withLineText(project, anchor, current, text));
export const setLineTranslation = (anchor: LineAnchor, translation: string, original: string | undefined) => updateProject(project => withLineTranslation(project, anchor, translation, original));

/** 拖逐字时间。coalesce 相同的连续修改合并成一步撤销（一次拖动传同一个 key）。 */
export const setLineWords = (anchor: LineAnchor, current: Line, words: TimedUnit[], bounds?: { startTime: number; endTime: number }, coalesce?: string) => {
    let ok = true;
    updateProject(project => {
        const next = withLineWords(project, anchor, current, words, bounds);
        if (!next) ok = false;
        return next ?? project;
    }, coalesce ? { coalesce: `line-words:${anchor.index}:${coalesce}` } : undefined);
    return ok;
};

export const resetLineTiming = (anchor: LineAnchor) => updateProject(project => withoutLineTiming(project, anchor));
export const resetLineText = (anchor: LineAnchor) => updateProject(project => withoutLineText(project, anchor));
export const resetLineTranslation = (anchor: LineAnchor) => updateProject(project => withoutLineTranslation(project, anchor));
export const resetLine = (anchor: LineAnchor) => updateProject(project => withoutLineEdit(project, anchor));

export const setLineSegments = (anchor: LineAnchor, parts: string[] | null) => updateProject(project => withLineSegments(project, anchor, parts));
export const repairLineSegmentation = (anchor: LineAnchor, current: Line) => updateProject(project => withRepairedSegmentation(project, anchor, current));
