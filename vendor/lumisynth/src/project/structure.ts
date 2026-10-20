// src/project/structure.ts
// 手动分段、合并、移动段落边界、改段落性质。段落以「段首行」为锚点，所以分段结构一变，
// 挂在段首行上的编排（包 / energy / 族）、出场转场、手动性质都要跟着搬——这里在编辑动作里显式地搬，
// 搬不了的（比如合并时后一段的编排）丢掉并记下来，而不是让编译器去猜。
// 每个动作都会用改后的工程重编一次来确认结果（自动分段可能与记录的修改叠加或抵消）。
import { compileLumiProgram } from '@/compiler/compile';
import type { EditOp, LumiParagraph, LumiProgram, ParagraphKind, StructureEdit } from '@/compiler/types';
import type { LineAnchor } from '@/core/lyrics/edits';
import { newId } from './defaults';
import { updateProject } from './store';
import type { LumiProject } from './types';
import { t } from '@/i18n';

export interface StructureChange {
    project: LumiProject;
    /** 给用户看的说明（写进「输出」）。 */
    notes: string[];
}

const sameLine = (a: LineAnchor, b: LineAnchor) => a.index === b.index && a.hash === b.hash;

/** 用编排当时的歌词（已套用歌词修改）重编工程。 */
export const recompileProject = (project: LumiProject, program: LumiProgram) => compileLumiProgram({
    lines: program.lines.map(line => line.line),
    seed: project.seed,
    direction: project.direction,
    paragraphDirections: project.paragraphDirections,
    overrides: project.overrides,
    structureEdits: project.structureEdits,
    library: project.library,
    params: project.engineParams,
    packTunings: project.tuning.packs,
});

const startsParagraph = (program: LumiProgram, lineIndex: number) => program.paragraphs.some(paragraph => paragraph.lineIndices[0] === lineIndex);

const withoutStructureAt = (edits: StructureEdit[], anchor: LineAnchor, types: StructureEdit['type'][]) => (
    edits.filter(edit => !(types.includes(edit.type) && sameLine(edit.anchor, anchor)))
);

/** 让 anchor 这一行是 / 不是段首：先去掉这一行已有的分段记录，重编看结果，不对再补一条。 */
export const setBoundary = (project: LumiProject, program: LumiProgram, anchor: LineAnchor, wanted: boolean): LumiProject => {
    const cleared: LumiProject = { ...project, structureEdits: withoutStructureAt(project.structureEdits, anchor, ['break', 'join']) };
    if (startsParagraph(recompileProject(cleared, program), anchor.index) === wanted) return cleared;
    return { ...cleared, structureEdits: [...cleared.structureEdits, { id: newId(), type: wanted ? 'break' : 'join', anchor }] };
};

/** 把挂在 from 段首行上的编排、转场、性质搬到 to（mode = copy 时原处保留）。 */
export const moveParagraphSettings = (project: LumiProject, from: LineAnchor, to: LineAnchor, parts: { direction: 'move' | 'copy' | 'keep'; transition: 'move' | 'keep'; kind: 'move' | 'copy' | 'keep' }): LumiProject => {
    let next = project;
    const direction = next.paragraphDirections.find(item => sameLine(item.anchor.line, from));
    if (direction && parts.direction !== 'keep') {
        const others = next.paragraphDirections.filter(item => !sameLine(item.anchor.line, to) && (parts.direction === 'copy' || item !== direction));
        next = { ...next, paragraphDirections: [...others, { ...direction, anchor: { line: to } }] };
    }
    const transition = next.overrides.find((op): op is Extract<EditOp, { type: 'transition' }> => op.type === 'transition' && sameLine(op.anchor.line, from));
    if (transition && parts.transition === 'move') {
        const others = next.overrides.filter(op => op !== transition && !(op.type === 'transition' && sameLine(op.anchor.line, to)));
        next = { ...next, overrides: [...others, { ...transition, anchor: { line: to } }] };
    }
    const kind = next.structureEdits.find(edit => edit.type === 'kind' && sameLine(edit.anchor, from));
    if (kind && parts.kind !== 'keep') {
        const others = next.structureEdits.filter(edit => !(edit.type === 'kind' && sameLine(edit.anchor, to)) && (parts.kind === 'copy' || edit !== kind));
        next = { ...next, structureEdits: [...others, { ...kind, id: newId(), anchor: to }] };
    }
    return next;
};

export const dropParagraphSettings = (project: LumiProject, anchor: LineAnchor, what: { direction?: boolean; transition?: boolean; kind?: boolean }) => {
    const dropped: string[] = [];
    let next = project;
    if (what.direction && next.paragraphDirections.some(item => sameLine(item.anchor.line, anchor))) {
        next = { ...next, paragraphDirections: next.paragraphDirections.filter(item => !sameLine(item.anchor.line, anchor)) };
        dropped.push(t('project:structure.parts.direction'));
    }
    if (what.transition && next.overrides.some(op => op.type === 'transition' && sameLine(op.anchor.line, anchor))) {
        next = { ...next, overrides: next.overrides.filter(op => !(op.type === 'transition' && sameLine(op.anchor.line, anchor))) };
        dropped.push(t('project:structure.parts.transition'));
    }
    if (what.kind && next.structureEdits.some(edit => edit.type === 'kind' && sameLine(edit.anchor, anchor))) {
        next = { ...next, structureEdits: next.structureEdits.filter(edit => !(edit.type === 'kind' && sameLine(edit.anchor, anchor))) };
        dropped.push(t('project:structure.parts.kind'));
    }
    return { project: next, dropped };
};

const paragraphOfLine = (program: LumiProgram, lineIndex: number) => program.paragraphs.find(paragraph => paragraph.lineIndices.includes(lineIndex));

// ---------------------------------------------------------------------------------------------
// 纯函数（便于测试）

/** 在 lineIndex 这一行开新段。新段落沿用原段落的编排与性质，原段落的出场转场归新段落（它在末尾）。 */
export const planSplit = (project: LumiProject, program: LumiProgram, lineIndex: number): StructureChange | null => {
    const paragraph = paragraphOfLine(program, lineIndex);
    const line = program.lines[lineIndex];
    if (!paragraph || !line || paragraph.lineIndices[0] === lineIndex) return null;
    const anchor = line.anchor;
    let next = setBoundary(project, program, anchor, true);
    next = moveParagraphSettings(next, paragraph.anchor.line, anchor, { direction: 'copy', transition: 'move', kind: 'copy' });
    return { project: next, notes: [t('project:structure.split', { n: paragraph.index + 1, line: lineIndex + 1 })] };
};

/** 把 paragraph 并进上一段。它自己的编排与性质丢掉；两段之间的转场丢掉，它的出场转场归合并后的段落。 */
export const planMergeWithPrevious = (project: LumiProject, program: LumiProgram, paragraph: LumiParagraph): StructureChange | null => {
    const previous = program.paragraphs[paragraph.index - 1];
    if (!previous) return null;
    const anchor = paragraph.anchor.line;
    let next = setBoundary(project, program, anchor, false);
    const between = dropParagraphSettings(next, previous.anchor.line, { transition: true });
    next = between.project;
    next = moveParagraphSettings(next, anchor, previous.anchor.line, { direction: 'keep', transition: 'move', kind: 'keep' });
    const own = dropParagraphSettings(next, anchor, { direction: true, kind: true });
    next = own.project;
    const notes = [t('project:structure.merged', { n: paragraph.index + 1, into: previous.index + 1 })];
    if (own.dropped.length > 0) notes.push(t('project:structure.droppedOwn', { parts: own.dropped.join(t('project:structure.listSeparator')) }));
    if (between.dropped.length > 0) notes.push(t('project:structure.droppedBetween'));
    return { project: next, notes };
};

/** 把 paragraph 的段首移到 lineIndex（只能在上一段段首之后、本段最后一行之内），它的设置跟着段首走。 */
export const planMoveStart = (project: LumiProject, program: LumiProgram, paragraph: LumiParagraph, lineIndex: number): StructureChange | null => {
    const previous = program.paragraphs[paragraph.index - 1];
    const from = paragraph.anchor.line;
    const target = program.lines[lineIndex];
    if (!previous || !target || lineIndex === from.index) return null;
    if (lineIndex <= previous.lineIndices[0] || lineIndex > paragraph.lineIndices.at(-1)!) return null;
    let next = setBoundary(project, program, from, false);
    next = setBoundary(next, program, target.anchor, true);
    next = moveParagraphSettings(next, from, target.anchor, { direction: 'move', transition: 'move', kind: 'move' });
    return { project: next, notes: [t('project:structure.moved', { n: paragraph.index + 1, line: lineIndex + 1 })] };
};

/**
 * 把第 from..to 行（0 起，含两端）切成独立的一段：范围里面的段首先并掉（从后往前，按合并的规则丢设置），
 * 再在 from 与 to + 1 开新段（按拆分的规则沿用原段落的编排）。每一步都用改后的工程重编再做下一步。
 */
export const planIsolate = (project: LumiProject, program: LumiProgram, from: number, to: number): StructureChange | null => {
    const count = program.lines.length;
    if (from < 0 || to >= count || to < from) return null;
    let next = project;
    let current = program;
    const notes: string[] = [];
    const inner = current.paragraphs.filter(paragraph => paragraph.lineIndices[0] > from && paragraph.lineIndices[0] <= to).map(paragraph => paragraph.lineIndices[0]);
    for (const start of inner.reverse()) {
        const paragraph = current.paragraphs.find(item => item.lineIndices[0] === start);
        const merged = paragraph ? planMergeWithPrevious(next, current, paragraph) : null;
        if (!merged) continue;
        next = merged.project;
        current = recompileProject(next, program);
    }
    for (const start of [from, to + 1]) {
        if (start >= count || current.paragraphs.some(paragraph => paragraph.lineIndices[0] === start)) continue;
        const split = planSplit(next, current, start);
        if (!split) continue;
        next = split.project;
        current = recompileProject(next, program);
    }
    if (next === project) return null;
    const own = current.paragraphs.find(paragraph => paragraph.lineIndices[0] === from);
    const lines = to > from ? `${from + 1}–${to + 1}` : `${from + 1}`;
    notes.push(own ? t('project:structure.isolatedAs', { lines, n: own.index + 1, count: to - from + 1 }) : t('project:structure.isolated', { lines, count: to - from + 1 }));
    return { project: next, notes };
};

/** 去掉这一段范围内所有的分段 / 合并记录，交回自动分段。 */
export const planResetStructure = (project: LumiProject, program: LumiProgram, paragraph: LumiParagraph): StructureChange | null => {
    const lines = new Set(paragraph.lineIndices);
    const next = project.structureEdits.filter(edit => edit.type === 'kind' || !lines.has(edit.anchor.index));
    if (next.length === project.structureEdits.length) return null;
    return { project: { ...project, structureEdits: next }, notes: [t('project:structure.reset', { n: paragraph.index + 1 })] };
};

/** 以 anchor 开头的段落的性质（'auto' 交回自动判断）。 */
export const withParagraphKind = (project: LumiProject, anchor: LineAnchor, kind: ParagraphKind | 'auto'): LumiProject => {
    const others = project.structureEdits.filter(edit => !(edit.type === 'kind' && sameLine(edit.anchor, anchor)));
    return { ...project, structureEdits: kind === 'auto' ? others : [...others, { id: newId(), type: 'kind', anchor, kind }] };
};

export const planSetKind = (project: LumiProject, paragraph: LumiParagraph, kind: ParagraphKind | 'auto'): StructureChange => {
    return {
        project: withParagraphKind(project, paragraph.anchor.line, kind),
        notes: [kind === 'auto' ? t('project:structure.kindAuto', { n: paragraph.index + 1 }) : t('project:structure.kind', { n: paragraph.index + 1, kind: t(`common:paragraphKinds.${kind}`) })],
    };
};

// ---------------------------------------------------------------------------------------------
// 动作（进撤销栈）

type Log = (message: string) => void;

const apply = (plan: (project: LumiProject) => StructureChange | null, log?: Log) => {
    let notes: string[] = [];
    updateProject(project => {
        const change = plan(project);
        if (!change) return project;
        notes = change.notes;
        return change.project;
    });
    notes.forEach(note => log?.(note));
    return notes.length > 0;
};

export const splitParagraphAt = (program: LumiProgram, lineIndex: number, log?: Log) => apply(project => planSplit(project, program, lineIndex), log);
export const mergeWithPrevious = (program: LumiProgram, paragraph: LumiParagraph, log?: Log) => apply(project => planMergeWithPrevious(project, program, paragraph), log);
export const moveParagraphStart = (program: LumiProgram, paragraph: LumiParagraph, lineIndex: number, log?: Log) => apply(project => planMoveStart(project, program, paragraph, lineIndex), log);
export const isolateLines = (program: LumiProgram, from: number, to: number, log?: Log) => apply(project => planIsolate(project, program, from, to), log);
export const resetParagraphStructure = (program: LumiProgram, paragraph: LumiParagraph, log?: Log) => apply(project => planResetStructure(project, program, paragraph), log);
export const setParagraphKind = (paragraph: LumiParagraph, kind: ParagraphKind | 'auto', log?: Log) => apply(project => planSetKind(project, paragraph, kind), log);
