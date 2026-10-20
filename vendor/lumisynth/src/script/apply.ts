// src/script/apply.ts
// 把剧本应用到工程（LumiScript v2，声明式）：剧本里写了的部分整体换成剧本写的样子，没写的部分不动。
//   - 全曲设置（seed、direction、mix、shot-mixing、lyric-offset）：每条单独算，写了就设成这个值；
//   - 段落块：只要写了一个，分段、段落性质、段落编排、出场转场、镜头的锁定与组件就全部按剧本来。
//     生成的剧本把自动选出的值也写出来：值没改、也没标 locked / @ai 的保持自动（换 seed 会重新选），
//     改了值或者标了 locked / @ai 的固定下来；没写的指令、写 auto 的是自动；`paragraphs auto` 全部交回自动；
//   - 歌词行：写了的行按写的来（文字、译文、时间、逐字、分词），没写的行不动；
//   - 背景块 / 素材片段块：写了已有的片段（带 id）或 `backgrounds none` / `clips none`，就是完整的列表
//     （没写的片段删除，none 先清空）；只写了新片段（不带 id）就是加上这些。
// 编排里做不到的指令（风格锁不上、镜头不存在……）是错误，标回写它的那一行。
// 剧本表达不了的东西（锚点失效的修改）原样保留。
// 做法分阶段：检查 → 全曲设置与歌词 → 分段 → 段落编排与转场 → 编译，按编出来的镜头解读 shot → 片段 → 编译并核对。
// 纯函数：结果是一个新的工程对象，由调用方一次写进撤销栈。
import {
    DEFAULT_MIX_BY_KIND,
    mixAssignment,
    mixOverrides,
    PARAGRAPH_KINDS,
    type EditOp,
    type LumiProgram,
    type ParagraphDirectionOverride,
    type ParagraphKind,
    type ShotAnchor,
    type StructureEdit,
} from '@/compiler/types';
import type { AssetClip, ClipTiming } from '@/core/assets/clips';
import { DEFAULT_CLIP_LOOK, normalizeClipEffect, normalizeClipMotion, resolveClipRange } from '@/core/assets/clips';
import type { BackgroundClip, BackgroundSource } from '@/core/assets/background';
import { DEFAULT_BACKGROUND_LOOK } from '@/core/assets/background';
import { applyLineEdit, type LineAnchor, type LineEdit } from '@/core/lyrics/edits';
import { isValidWordSegmentation } from '@/core/lyrics/wordSegmentation';
import type { Line } from '@/core/types';
import { getStyle } from '@/packs/registry';
import { newId } from '@/project/defaults';
import type { LumiProject } from '@/project/types';
import { checkScript, componentProblem, type CheckInput, type Resolved } from './check';
import { error, hasErrors, warning, type Diagnostic, type Span } from './diagnostics';
import { parseScript, type At, type BackgroundNode, type ClipNode, type ParagraphNode, type ScriptDoc, type SourceNode, type TimingNode } from './parse';
import { KIND_LABELS } from './print';
import { formatRange, near, quote, shortId } from './syntax';

export interface ScriptEnv extends CheckInput {
    /** 用工程自己的歌词（套上它的歌词修改）编译。 */
    compile: (project: LumiProject) => LumiProgram;
}

export interface ApplyScriptResult {
    /** 没有错误时是改好的工程（没有任何修改时就是传入的那个对象）；有错误时是传入的工程。 */
    project: LumiProject;
    /** 给人看的修改说明。 */
    changes: string[];
    diagnostics: Diagnostic[];
    ok: boolean;
}

const sameLine = (a: LineAnchor, b: LineAnchor) => a.index === b.index && a.hash === b.hash;
const sameAnchor = (a: ShotAnchor, b: ShotAnchor) => sameLine(a.line, b.line) && a.slot === b.slot;
const startsOf = (program: LumiProgram) => program.paragraphs.map(paragraph => paragraph.lineIndices[0]);
const sortDiagnostics = (items: Diagnostic[]) => [...items].sort((a, b) => a.line - b.line || (a.from ?? 0) - (b.from ?? 0));

/** 同一个对象集合（顺序无关）。 */
const sameSet = <T>(a: T[], b: T[]) => a.length === b.length && a.every(item => b.includes(item));

// ---------------------------------------------------------------------------------------------

export const applyScript = (text: string, env: ScriptEnv): ApplyScriptResult => {
    const { project, program, sourceLines, compile } = env;
    const parsed = parseScript(text);
    const doc = parsed.doc;
    const checked = checkScript(doc, env);
    const diagnostics = [...parsed.diagnostics, ...checked.diagnostics];
    const fail = () => ({ project, changes: [], diagnostics: sortDiagnostics(diagnostics), ok: false });
    if (hasErrors(diagnostics)) return fail();

    const changes: string[] = [];
    let next = applyTop(doc, project, changes);
    next = applyLyrics(doc, next, env, changes);

    const arranged = doc.paragraphsAuto
        ? resetArrangement(next, program, changes)
        : doc.paragraphs.length > 0
            ? applyParagraphs(doc, next, env, checked.resolved, diagnostics, changes)
            : { project: next, program: null, origin: new Map<object, Span>() };
    if (!arranged) return fail();
    next = arranged.project;
    // 片段挂在段落 / 镜头上：按改过的分段与编出来的镜头找锚点。
    const shaped = arranged.program ?? (next === project ? program : compile(next));
    next = applyClips(doc, next, env, shaped, checked.resolved, diagnostics, changes);
    next = applyBackgrounds(doc, next, env, shaped, checked.resolved, diagnostics, changes);
    if (hasErrors(diagnostics)) return fail();

    // ---- 核对：剧本写的修改都生效了
    if (next !== project) {
        const after = compile(next);
        verify(after, arranged.origin, diagnostics, project);
        const placed: Array<AssetClip | BackgroundClip> = [...next.assetClips, ...next.backgroundClips];
        [...doc.clips, ...doc.backgrounds].forEach(node => {
            const at = node.fields.at;
            if (!at || at.value.type === 'missing') return;
            const target = placed.find(item => clipOrigin.get(item) === node);
            if (target && !resolveClipRange(target.timing, after)) {
                diagnostics.push(error('LS309', at, '编排里找不到这个挂载点', { hint: '段落或镜头的编号按这次应用之后的编排数；可以先挂在 paragraph N，应用后再改' }));
            }
        });
        if (hasErrors(diagnostics)) return fail();
    }
    return { project: next, changes, diagnostics: sortDiagnostics(diagnostics), ok: true };
};

/** 编辑器的实时检查：整个应用走一遍（不写进工程），给出所有阶段的诊断。 */
export const lintScript = (text: string, env: ScriptEnv): Diagnostic[] => applyScript(text, env).diagnostics;

// ---------------------------------------------------------------------------------------------
// 全曲设置

const applyTop = (doc: ScriptDoc, project: LumiProject, changes: string[]): LumiProject => {
    let next = project;
    if (doc.seed && doc.seed.value !== next.seed) {
        next = { ...next, seed: doc.seed.value };
        changes.push(`seed 改为 ${quote(doc.seed.value)}`);
    }
    if (doc.direction) {
        const value = doc.direction.value;
        const current = next.direction;
        if (value.mode === 'single' && (current.mode !== 'single' || current.pack !== value.pack.value)) {
            next = { ...next, direction: { ...current, mode: 'single', pack: value.pack.value } };
            changes.push(`全曲用 ${value.pack.value}`);
        } else if (value.mode === 'mix' && current.mode !== 'mix') {
            next = { ...next, direction: { ...current, mode: 'mix' } };
            changes.push('改为按段落性质混用风格包');
        }
    }
    if (doc.mix.length > 0) {
        const current = mixAssignment(next.direction);
        const wanted = { ...DEFAULT_MIX_BY_KIND };
        doc.mix.forEach(item => { wanted[item.kind.value] = item.pack.value; });
        const differs = PARAGRAPH_KINDS.filter(kind => wanted[kind] !== current[kind]);
        if (differs.length > 0) {
            next = { ...next, direction: { ...next.direction, mixByKind: mixOverrides(wanted) } };
            differs.forEach(kind => changes.push(`混用时${KIND_LABELS[kind]}用 ${wanted[kind]}`));
        }
    }
    if (doc.shotMixing && doc.shotMixing.value !== next.direction.shotMixing) {
        next = { ...next, direction: { ...next.direction, shotMixing: doc.shotMixing.value } };
        changes.push(doc.shotMixing.value ? '打开按镜头混用' : '关闭按镜头混用');
    }
    if (doc.lyricOffset && !near(doc.lyricOffset.value, next.lyricEdits.offset)) {
        next = { ...next, lyricEdits: { ...next.lyricEdits, offset: doc.lyricOffset.value } };
        changes.push(`歌词整体偏移改为 ${doc.lyricOffset.value} 秒`);
    }
    return next;
};

// ---------------------------------------------------------------------------------------------
// 歌词行

const sameWords = (a: Line, b: Line) => a.words.length === b.words.length
    && a.words.every((word, i) => word.text === b.words[i].text && near(word.startTime, b.words[i].startTime) && near(word.endTime, b.words[i].endTime));

const sameLineEffect = (a: Line, b: Line) => a.fullText === b.fullText
    && (a.translation ?? '') === (b.translation ?? '')
    && near(a.startTime, b.startTime) && near(a.endTime, b.endTime)
    && sameWords(a, b);

const applyLyrics = (doc: ScriptDoc, project: LumiProject, { program, sourceLines }: ScriptEnv, changes: string[]): LumiProject => {
    if (!sourceLines) return project;
    let lines = project.lyricEdits.lines;
    let segments = project.lyricEdits.segments;
    doc.paragraphs.flatMap(paragraph => paragraph.lyricLines).forEach(node => {
        const index = node.number.value - 1;
        const source = sourceLines[index];
        const anchor = program.lines[index]?.anchor;
        if (!source || !anchor) return;
        const label = `第 ${index + 1} 行`;
        const text = node.text.value.replace(/[\r\n]+/g, ' ');
        const { start, end } = node.range.value;
        const wanted: LineEdit = { anchor };
        if (text !== source.fullText) wanted.text = text;
        const translation = node.translation?.value.replace(/[\r\n]+/g, ' ').trim();
        if (translation !== undefined && translation !== (source.translation ?? '').trim()) wanted.translation = translation;
        if (!near(start, source.startTime) || !near(end, source.endTime)) {
            wanted.startTime = start;
            wanted.endTime = end;
        }
        if (node.words) wanted.words = node.words.map(word => ({ text: word.text.value, startTime: word.range.value.start, endTime: word.range.value.end }));

        const existing = lines.find(item => sameLine(item.anchor, anchor));
        const before = existing ? applyLineEdit(source, existing) : source;
        const after = applyLineEdit(source, wanted);
        if (!sameLineEffect(before, after)) {
            const empty = wanted.text === undefined && wanted.translation === undefined && wanted.startTime === undefined && wanted.words === undefined;
            lines = [...lines.filter(item => item !== existing), ...(empty ? [] : [wanted])];
            if (empty) changes.push(`${label}恢复原样`);
            else {
                const translationChanged = (after.translation ?? '') !== (before.translation ?? '');
                if (after.fullText !== before.fullText) changes.push(`${label}改字：「${before.fullText}」→「${after.fullText}」`);
                if (translationChanged) changes.push(after.translation ? `${label}的译文改为「${after.translation}」` : `${label}不显示译文`);
                if (!near(after.startTime, before.startTime) || !near(after.endTime, before.endTime)) changes.push(`${label}的时间改为 ${formatRange(start, end)}`);
                else if (after.fullText === before.fullText && !sameWords(before, after)) changes.push(`${label}的逐字时间`);
            }
        }

        // 分词：写了 parts 就是手动分词；没写就用自动分词——除非原来的手动分词已经失效（剧本写不出来，保留）。
        const saved = segments.find(item => sameLine(item.anchor, anchor));
        const currentText = program.lines[index].line.fullText;
        if (node.parts) {
            const parts = node.parts.value;
            if (!saved || saved.parts.join('\u0000') !== parts.join('\u0000')) {
                segments = [...segments.filter(item => item !== saved), { anchor, parts }];
                changes.push(`${label}的分词`);
            }
        } else if (saved && isValidWordSegmentation(currentText, saved.parts)) {
            segments = segments.filter(item => item !== saved);
            changes.push(`${label}改回自动分词`);
        }
    });
    if (lines === project.lyricEdits.lines && segments === project.lyricEdits.segments) return project;
    return { ...project, lyricEdits: { ...project.lyricEdits, lines, segments } };
};

// ---------------------------------------------------------------------------------------------
// 段落

/** 剧本管得到的修改：在当前编排里生效的那些（失效的剧本写不出来，原样保留）。 */
const managed = (project: LumiProject, program: LumiProgram) => {
    const invalidOps = new Set(program.invalidOps.map(item => item.op));
    const invalidDirections = new Set(program.invalidDirections);
    const invalidStructure = new Set(program.invalidStructureEdits.map(item => item.edit));
    return {
        ops: project.overrides.filter(op => !invalidOps.has(op)),
        keptOps: project.overrides.filter(op => invalidOps.has(op)),
        directions: project.paragraphDirections.filter(item => !invalidDirections.has(item)),
        keptDirections: project.paragraphDirections.filter(item => invalidDirections.has(item)),
        structure: project.structureEdits.filter(edit => !invalidStructure.has(edit)),
        keptStructure: project.structureEdits.filter(edit => invalidStructure.has(edit)),
    };
};

const resetArrangement = (project: LumiProject, program: LumiProgram, changes: string[]) => {
    const own = managed(project, program);
    if (own.ops.length === 0 && own.directions.length === 0 && own.structure.length === 0) {
        return { project, program: null, origin: new Map<object, Span>() };
    }
    changes.push('分段、段落编排、转场与镜头全部交回自动');
    return {
        project: { ...project, overrides: own.keptOps, paragraphDirections: own.keptDirections, structureEdits: own.keptStructure },
        program: null,
        origin: new Map<object, Span>(),
    };
};

interface Arranged {
    project: LumiProject;
    /** 按剧本分好段、编好镜头的编排（片段按它找锚点）。 */
    program: LumiProgram | null;
    /** 剧本写出来的修改 → 写它的位置（核对编译结果时用）。 */
    origin: Map<object, Span>;
}

/** 写了 locked / @ai：固定下来。 */
const marked = (directive: { locked: boolean; ai: boolean }) => directive.locked || directive.ai;

const applyParagraphs = (
    doc: ScriptDoc,
    project: LumiProject,
    env: ScriptEnv,
    resolved: Resolved,
    diagnostics: Diagnostic[],
    changes: string[],
): Arranged | null => {
    const { program, compile } = env;
    const own = managed(project, program);
    const origin = new Map<object, Span>();
    const anchorAt = (index: number) => program.lines[index].anchor;
    const starts = doc.paragraphs.map(paragraph => resolved.ranges.get(paragraph)!.start);
    const wantedStarts = new Set(starts);
    const label = (index: number) => `第 ${index + 1} 段`;
    // 剧本里写出来的值是按当前编排写的：每个段落块对照当前编排里包含它段首行的那一段
    // （分段没变时就是它自己；拆出来的块对照原来的整段）。值没改、也没标 locked / @ai 的保持自动。
    const basedOn = doc.paragraphs.map((_, index) => program.paragraphs.find(item => item.lineIndices.includes(starts[index])) ?? null);

    // ---- ① 分段与性质
    const kindEdits: StructureEdit[] = doc.paragraphs.flatMap((paragraph, index) => {
        const kind = paragraph.kind;
        if (!kind || (!marked(kind) && kind.value === basedOn[index]?.kind)) return [];
        const anchor = anchorAt(starts[index]);
        const existing = own.structure.find(edit => edit.type === 'kind' && sameLine(edit.anchor, anchor) && edit.kind === kind.value);
        const edit: StructureEdit = existing ?? { id: newId(), type: 'kind', anchor, kind: kind.value };
        origin.set(edit, kind);
        return [edit];
    });
    const withStructure = (boundaries: StructureEdit[]) => [...own.keptStructure, ...boundaries, ...kindEdits];
    let boundaries = own.structure.filter(edit => edit.type !== 'kind');
    let shaped = compile({ ...project, structureEdits: withStructure(boundaries) });
    const matches = (candidate: LumiProgram) => candidate.paragraphs.length === starts.length && startsOf(candidate).every((start, i) => start === starts[i]);
    if (!matches(shaped)) {
        // 从自动分段出发，缺的段首补 break、多的补 join；合并会取消行数 / 时长上限的切分，所以再编几轮直到对上。
        boundaries = [];
        for (let round = 0; round < 6; round += 1) {
            shaped = compile({ ...project, structureEdits: withStructure(boundaries) });
            const actual = new Set(startsOf(shaped));
            const missing = starts.filter(start => !actual.has(start));
            const extra = [...actual].filter(start => !wantedStarts.has(start));
            if (missing.length === 0 && extra.length === 0) break;
            const at = (start: number) => anchorAt(start);
            boundaries = boundaries.filter(edit => !missing.some(start => sameLine(edit.anchor, at(start))) && !extra.some(start => sameLine(edit.anchor, at(start))));
            missing.forEach(start => boundaries.push({ id: newId(), type: 'break', anchor: at(start) }));
            extra.forEach(start => boundaries.push({ id: newId(), type: 'join', anchor: at(start) }));
        }
        if (!matches(shaped)) {
            const actual = new Set(startsOf(shaped));
            doc.paragraphs.forEach((paragraph, index) => {
                if (actual.has(starts[index])) return;
                diagnostics.push(error('LS401', paragraph.head, `没法让${label(index)}从第 ${starts[index] + 1} 行开始`, { hint: '可能是这一行在歌词里不能作为段首；换一行试试' }));
            });
            return null;
        }
    }
    const structureEdits = withStructure(boundaries);
    const before = new Set(startsOf(program));
    starts.filter(start => !before.has(start)).forEach(start => changes.push(`在第 ${start + 1} 行开新段`));
    [...before].filter(start => !wantedStarts.has(start)).forEach(start => changes.push(`第 ${start + 1} 行起的段落并进上一段`));
    doc.paragraphs.forEach((_, index) => {
        const old = program.paragraphs.find(item => item.lineIndices[0] === starts[index]);
        const anchor = anchorAt(starts[index]);
        const wanted = kindEdits.find(edit => sameLine(edit.anchor, anchor));
        const had = old?.kindManual ? old.kind : null;
        const now = wanted?.type === 'kind' ? wanted.kind : null;
        if (old && now !== had) changes.push(now ? `${label(index)}的性质固定为${KIND_LABELS[now]}` : `${label(index)}的性质交回自动判断`);
    });

    // ---- ② 段落编排与出场转场
    const directions: ParagraphDirectionOverride[] = [];
    const transitionOps: EditOp[] = [];
    doc.paragraphs.forEach((paragraph, index) => {
        const anchor = { line: anchorAt(starts[index]) };
        const current = basedOn[index]?.direction ?? null;
        const pinned: Array<{ ai: boolean }> = [];
        const wanted: Partial<ParagraphDirectionOverride> = {};
        const { pack, energy, families } = paragraph;
        if (pack && pack.value !== 'auto' && (marked(pack) || pack.value !== current?.pack)) {
            wanted.pack = pack.value;
            pinned.push(pack);
        }
        if (energy && energy.value !== 'auto' && (marked(energy) || current?.energy === null || current?.energy === undefined || !near(energy.value, current.energy))) {
            wanted.energy = energy.value;
            pinned.push(energy);
        }
        if (families && families.value !== 'auto') {
            const value = families.value === 'all' ? null : families.value;
            if (marked(families) || JSON.stringify(value) !== JSON.stringify(current?.families ?? null)) {
                wanted.families = value;
                pinned.push(families);
            }
        }
        const override: ParagraphDirectionOverride | null = pinned.length === 0 ? null : {
            anchor, ...wanted, source: pinned.every(item => item.ai) ? 'ai' : 'user',
        };
        const existing = own.directions.find(item => sameLine(item.anchor.line, anchor.line));
        const same = override && existing && sameDirection(override, existing);
        const kept = same ? existing : override;
        if (kept) {
            directions.push(kept);
            origin.set(kept, pack ?? energy ?? families ?? paragraph.head);
        }
        if (!same && (override || existing)) changes.push(override ? `${label(index)}：${describeDirection(override)}` : `${label(index)}的编排交回自动`);

        const transition = paragraph.transition;
        const isLast = index === doc.paragraphs.length - 1;
        const existingOp = own.ops.find((op): op is Extract<EditOp, { type: 'transition' }> => op.type === 'transition' && sameLine(op.anchor.line, anchor.line));
        const currentTransition = basedOn[index]?.transitionOut?.id ?? 'none';
        const pin = transition && transition.value !== 'auto' && !isLast && (marked(transition) || transition.value !== currentTransition);
        if (pin) {
            const sameOp = existingOp && existingOp.transition === transition.value && existingOp.id.startsWith('ai-') === transition.ai;
            const op: EditOp = sameOp ? existingOp : { id: `${transition.ai ? 'ai-' : ''}${newId()}`, type: 'transition', anchor, transition: transition.value };
            transitionOps.push(op);
            origin.set(op, transition);
            if (!sameOp) changes.push(`${label(index)}的出场转场：${transition.value === 'none' ? '不要转场' : transition.value}`);
        } else if (existingOp && !isLast) {
            changes.push(`${label(index)}的出场转场交回自动`);
        }
    });

    // ---- ③ 镜头：shot N 指剧本生成时这一段的第 N 个镜头；分段改了的段落，改过的镜头按新编出来的第 N 个套上去
    const shotOps = own.ops.filter(op => op.type !== 'transition');
    const staged: LumiProject = {
        ...project,
        structureEdits,
        paragraphDirections: [...own.keptDirections.filter(item => !directions.some(other => sameLine(other.anchor.line, item.anchor.line))), ...directions],
        overrides: [...own.keptOps, ...shotOps, ...transitionOps],
    };
    const staging = compile(staged);
    const nextShotOps: EditOp[] = [];
    const describeShot = (paragraphIndex: number, shotIndex: number) => `镜头 ${paragraphIndex + 1}.${shotIndex + 1}`;
    doc.paragraphs.forEach((paragraph, index) => {
        const same = program.paragraphs.find(item => item.lineIndices[0] === starts[index] && item.lineIndices.at(-1) === resolved.ranges.get(paragraph)!.end);
        // 剧本里写的值对照的镜头，与改了之后要套上去的镜头。
        const printed = (same ?? basedOn[index])?.shots ?? [];
        const targets = same?.shots ?? staging.paragraphs[index].shots;
        let warned = false;
        paragraph.shots.forEach(node => {
            const shown = printed[node.number.value - 1];
            const style = node.style;
            const lockStyle = style && (marked(style) || style.value !== shown?.style);
            // 换成别的包的风格时，剧本里还留着原来那个包的组件：去掉（换包后组件由新包自动选），给个提示。
            const was = shown ? getStyle(shown.style) : undefined;
            const written = node.components.filter(component => {
                const problem = resolved.foreignComponents.get(component);
                if (!problem) return true;
                const { slot, value } = component;
                const leftover = was && style && was.pack !== getStyle(style.value)?.pack && shown?.components[slot.value] === value.value;
                if (leftover) {
                    diagnostics.push(warning('LS903', slot, `${style.value} 属于 ${getStyle(style.value)?.pack}，原来 ${was.pack} 的组件 ${slot.value} ${value.value} 用不上，已去掉`, {
                        hint: '换了包之后组件由新包自动选；想指定就写新包的组件槽（见 list_styles），也可以直接删掉这一行',
                    }));
                } else diagnostics.push(problem);
                return false;
            });
            const components = written.filter(({ slot, value }) => value.value !== 'auto' && (marked(value) || value.value !== shown?.components[slot.value]));
            if (!lockStyle && components.length === 0) return;
            const shot = targets[node.number.value - 1];
            if (!shot) {
                diagnostics.push(error('LS317', node.number, `${label(index)}只有 ${targets.length} 个镜头`));
                return;
            }
            if (!same && !warned && program.paragraphs.some(item => item.lineIndices[0] === starts[index])) {
                warned = true;
                diagnostics.push(warning('LS901', node.number, `${label(index)}的分段改了，镜头按新的划分编号（这一段现在有 ${targets.length} 个镜头）`, {
                    hint: '镜头的锁定与组件是按序号套上去的；不确定的话先应用分段，重新载入剧本后再改镜头',
                }));
            }
            const name = describeShot(index, node.number.value - 1);
            if (lockStyle) {
                const existing = shotOps.find(op => op.type === 'shot-style' && sameAnchor(op.anchor, shot.anchor) && op.style === style.value);
                const op: EditOp = existing ?? { id: newId(), type: 'shot-style', anchor: shot.anchor, style: style.value };
                nextShotOps.push(op);
                origin.set(op, style);
            }
            const def = getStyle(lockStyle ? style.value : shot.style);
            components.forEach(({ slot, value }) => {
                if (!lockStyle && def) {
                    const problem = componentProblem(def.pack, def.kind, slot, value);
                    if (problem) {
                        diagnostics.push({ ...problem, message: `${problem.message}（${name} 的风格是 ${shot.style}）` });
                        return;
                    }
                }
                const existing = shotOps.find(op => op.type === 'shot-component' && sameAnchor(op.anchor, shot.anchor) && op.slot === slot.value && op.value === value.value);
                const op: EditOp = existing ?? { id: newId(), type: 'shot-component', anchor: shot.anchor, slot: slot.value, value: value.value };
                nextShotOps.push(op);
                origin.set(op, value);
            });
        });
    });
    if (hasErrors(diagnostics)) return null;
    describeShotChanges(shotOps, nextShotOps, staging, program, changes);

    const keptOps = own.keptOps.filter(op => !nextShotOps.concat(transitionOps).some(other => sameTarget(op, other)));
    const overrides = [...keptOps, ...nextShotOps, ...transitionOps];
    const paragraphDirections = staged.paragraphDirections;
    const unchanged = sameSet(overrides, project.overrides) && sameSet(paragraphDirections, project.paragraphDirections) && sameSet(structureEdits, project.structureEdits);
    if (unchanged) return { project, program: staging, origin };
    const arranged = { ...project, structureEdits, paragraphDirections, overrides };
    return { project: arranged, program: compile(arranged), origin };
};

const sameEnergy = (a: number | null | undefined, b: number | null | undefined) => (
    a === undefined || a === null ? b === undefined || b === null : b !== undefined && b !== null && near(a, b)
);

const sameDirection = (a: ParagraphDirectionOverride, b: ParagraphDirectionOverride) => a.source === b.source
    && a.pack === b.pack
    && sameEnergy(a.energy, b.energy)
    && JSON.stringify(a.families) === JSON.stringify(b.families);

const describeDirection = (direction: ParagraphDirectionOverride) => [
    direction.pack !== undefined ? `包 ${direction.pack}` : null,
    direction.energy !== undefined && direction.energy !== null ? `energy ${direction.energy}` : null,
    direction.families !== undefined ? `族 ${direction.families === null ? '不限' : direction.families.join(' ')}` : null,
    direction.source === 'ai' ? '（AI）' : null,
].filter(Boolean).join('，');

const sameTarget = (a: EditOp, b: EditOp) => {
    if (a.type !== b.type) return false;
    if (a.type === 'transition' && b.type === 'transition') return sameLine(a.anchor.line, b.anchor.line);
    if (a.type === 'shot-style' && b.type === 'shot-style') return sameAnchor(a.anchor, b.anchor);
    if (a.type === 'shot-component' && b.type === 'shot-component') return sameAnchor(a.anchor, b.anchor) && a.slot === b.slot;
    return false;
};

const describeShotChanges = (before: EditOp[], after: EditOp[], staging: LumiProgram, program: LumiProgram, changes: string[]) => {
    const name = (anchor: ShotAnchor) => {
        for (const candidate of [staging, program]) {
            for (const paragraph of candidate.paragraphs) {
                const index = paragraph.shots.findIndex(shot => sameAnchor(shot.anchor, anchor));
                if (index >= 0) return `镜头 ${paragraph.index + 1}.${index + 1}`;
            }
        }
        return `第 ${anchor.line.index + 1} 行的镜头`;
    };
    after.filter(op => !before.includes(op)).forEach(op => {
        if (op.type === 'shot-style') changes.push(`${name(op.anchor)} 锁定为 ${op.style}`);
        if (op.type === 'shot-component') changes.push(`${name(op.anchor)} 的 ${op.slot}：${op.value}`);
    });
    before.filter(op => !after.includes(op) && !after.some(other => sameTarget(op, other))).forEach(op => {
        if (op.type === 'shot-style') changes.push(`${name(op.anchor)} 解除锁定`);
        if (op.type === 'shot-component') changes.push(`${name(op.anchor)} 的 ${op.slot} 交回自动`);
    });
};

/**
 * 剧本写的修改在最终编排里没生效：标回写它的那一行。新写的是错误；原来就有、被这次别的修改
 * （换 seed、改歌词……）弄得对不上的只是提示——修改保留着，和在界面里改的时候一样进「问题」面板。
 */
const verify = (after: LumiProgram, origin: Map<object, Span>, diagnostics: Diagnostic[], before: LumiProject) => {
    const existed = new Set<object>([...before.overrides, ...before.paragraphDirections, ...before.structureEdits]);
    const report = (item: object, code: string, at: Span, message: string, hint?: string) => {
        diagnostics.push(existed.has(item)
            ? warning(code, at, `${message}；这条修改原来就有，保留着（见「问题」面板）`, { hint })
            : error(code, at, message, { hint }));
    };
    after.invalidOps.forEach(({ op, reason }) => {
        const at = origin.get(op);
        if (!at) return;
        const gone = '这个镜头在应用后的编排里不存在了（镜头划分变了）';
        if (op.type === 'shot-style') {
            const style = getStyle(op.style);
            if (reason === 'pack-mismatch') {
                report(op, 'LS402', at, `锁不上 ${op.style}：这一段由别的包来画`,
                    `写 shot-mixing on 让段内可以出现 ${style?.pack ?? '别的包'} 的镜头，或者换成这一段的包的风格（有的镜头，比如间奏，换不了包）`);
            } else report(op, 'LS404', at, gone, '先应用其余的修改，重新载入剧本后再锁这个镜头');
        } else if (op.type === 'shot-component') {
            if (reason === 'component-unknown') report(op, 'LS403', at, `这个镜头用不了 ${op.slot} ${op.value}（镜头的风格属于别的包）`, '换成这个镜头的包的组件，或者写 auto');
            else report(op, 'LS404', at, gone, '先应用其余的修改，重新载入剧本后再改这个镜头');
        } else {
            report(op, 'LS405', at, '这个转场没有生效（段落边界变了）');
        }
    });
    after.invalidDirections.forEach(item => {
        const at = origin.get(item);
        if (at) report(item, 'LS406', at, '这一段的编排没有生效（段首变了，或者包没有安装）');
    });
    after.invalidStructureEdits.forEach(({ edit }) => {
        const at = origin.get(edit);
        if (at) report(edit, 'LS401', at, '段落性质没有生效：这一行不是段首');
    });
};

// ---------------------------------------------------------------------------------------------
// 片段

/** 新建 / 改过的片段 → 写它的块（核对挂载点时找位置）。 */
const clipOrigin = new WeakMap<object, ClipNode | BackgroundNode>();

const toTiming = (
    node: At<TimingNode>,
    keep: ClipTiming | null,
    doc: ScriptDoc,
    env: ScriptEnv,
    shaped: LumiProgram,
    resolved: Resolved,
    diagnostics: Diagnostic[],
): ClipTiming | null => {
    const value = node.value;
    const anchorAt = (index: number): LineAnchor | null => env.program.lines[index]?.anchor ?? null;
    switch (value.type) {
        case 'song': return { type: 'song' };
        case 'missing': return keep;
        case 'absolute':
            if (keep?.type === 'absolute' && near(keep.start, value.start) && near(keep.end, value.end)) return keep;
            return { type: 'absolute', start: value.start, end: value.end };
        case 'lines': {
            const from = anchorAt(value.from - 1);
            const to = anchorAt(value.to - 1);
            return from && to ? { type: 'lines', from, to } : null;
        }
        case 'paragraph': {
            const start = doc.paragraphs.length > 0
                ? resolved.ranges.get(doc.paragraphs[value.paragraph - 1])?.start
                : shaped.paragraphs[value.paragraph - 1]?.lineIndices[0];
            const anchor = start === undefined ? null : anchorAt(start);
            return anchor ? { type: 'paragraph', anchor: { line: anchor } } : null;
        }
        case 'shot': {
            const paragraph = shaped.paragraphs[value.paragraph - 1];
            const shot = paragraph?.shots[value.shot - 1];
            if (!shot) {
                diagnostics.push(error('LS309', node, paragraph ? `第 ${value.paragraph} 段只有 ${paragraph.shots.length} 个镜头` : `只有 ${shaped.paragraphs.length} 段`));
                return null;
            }
            return { type: 'shot', anchor: shot.anchor };
        }
    }
};

const sameTiming = (a: ClipTiming, b: ClipTiming) => JSON.stringify(a) === JSON.stringify(b);

const CLIP_FIELD_LABELS: Record<string, string> = {
    assetId: '素材', timing: '挂载', lead: '提前', tail: '延后', slot: '层级', x: '位置', y: '位置', scale: '大小', rotation: '角度',
    opacity: '不透明度', flipX: '翻转', blend: '混合', enter: '入场', exit: '退场', follow: '跟随运镜', followAmount: '跟随运镜', effect: '附加效果', motion: '持续运动',
};
const BACKGROUND_FIELD_LABELS: Record<string, string> = {
    source: '来源', timing: '挂载', fit: '适配', kenBurns: '推近', blur: '模糊', dim: '压暗', fadeIn: '淡入', fadeOut: '淡出',
};

/** 写出来的值与原来的值在剧本的精度内相同时沿用原来的值（剧本里的数字只有两三位小数）。 */
const settle = <T extends object>(wanted: T, existing: T | null, tolerances: Partial<Record<keyof T, number>>): T => {
    if (!existing) return wanted;
    const result = { ...wanted };
    (Object.keys(tolerances) as Array<keyof T>).forEach(key => {
        const a = wanted[key];
        const b = existing[key];
        if (typeof a === 'number' && typeof b === 'number' && near(a, b, tolerances[key]!)) result[key] = b;
    });
    return result;
};

/** 比较用：旧工程可能没有的字段补上默认值。 */
const comparableClip = (clip: AssetClip) => ({
    ...clip,
    follow: clip.follow ?? 'off',
    followAmount: clip.followAmount ?? 1,
    effect: normalizeClipEffect(clip.effect),
    motion: normalizeClipMotion(clip.motion),
});

const changedKeys = <T extends object>(a: T, b: T) => (Object.keys({ ...a, ...b }) as Array<keyof T>).filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]));

const applyClips = (doc: ScriptDoc, project: LumiProject, env: ScriptEnv, shaped: LumiProgram, resolved: Resolved, diagnostics: Diagnostic[], changes: string[]): LumiProject => {
    if (doc.clips.length === 0 && !doc.clipsNone) return project;
    const clips: AssetClip[] = [];
    doc.clips.forEach(node => {
        const target = resolved.clips.get(node);
        if (!target) return;
        const existing = target === 'new' ? null : target;
        const f = node.fields;
        const timing = toTiming(f.at!, existing?.timing ?? null, doc, env, shaped, resolved, diagnostics);
        const asset = resolved.assets.get(f.asset!);
        if (!timing || !asset) return;
        const effect = f.effect ? normalizeClipEffect(Object.fromEntries(Object.entries(f.effect.value).filter(([, value]) => value !== undefined))) : normalizeClipEffect(null);
        const motion = f.motion ? normalizeClipMotion(Object.fromEntries(Object.entries(f.motion.value).filter(([, value]) => value !== undefined))) : normalizeClipMotion(null);
        const look = {
            ...DEFAULT_CLIP_LOOK,
            ...(f.extend ? { lead: f.extend.value[0], tail: f.extend.value[1] } : {}),
            ...(f.slot ? { slot: f.slot.value } : {}),
            ...(f.position ? { x: f.position.value[0], y: f.position.value[1] } : {}),
            ...(f.scale ? { scale: f.scale.value } : {}),
            ...(f.rotate ? { rotation: (f.rotate.value * Math.PI) / 180 } : {}),
            ...(f.opacity ? { opacity: f.opacity.value } : {}),
            ...(f.flip ? { flipX: f.flip.value } : {}),
            ...(f.blend ? { blend: f.blend.value } : {}),
            ...(f.enter ? { enter: f.enter.value } : {}),
            ...(f.exit ? { exit: f.exit.value } : {}),
            ...(f.follow ? { follow: f.follow.value.mode, followAmount: f.follow.value.amount } : {}),
        };
        let clip: AssetClip = settle({ id: existing?.id ?? newId(), assetId: asset.id, timing, ...look }, existing, {
            lead: 0.006, tail: 0.006, x: 0.0006, y: 0.0006, scale: 0.0006, rotation: 0.001, opacity: 0.006, followAmount: 0.006,
        });
        if (existing && existing.timing && sameTiming(existing.timing, clip.timing)) clip.timing = existing.timing;
        if (existing && existing.enter.type === clip.enter.type && near(existing.enter.duration, clip.enter.duration)) clip.enter = existing.enter;
        if (existing && existing.exit.type === clip.exit.type && near(existing.exit.duration, clip.exit.duration)) clip.exit = existing.exit;
        // 附加效果与持续运动：「无」时不写字段（与旧工程一致），数值在精度内沿用原来的。
        const oldEffect = normalizeClipEffect(existing?.effect);
        const sameEffect = oldEffect.type === effect.type && oldEffect.color === effect.color && near(oldEffect.size, effect.size) && near(oldEffect.opacity, effect.opacity) && near(oldEffect.period, effect.period);
        const oldMotion = normalizeClipMotion(existing?.motion);
        const sameMotion = oldMotion.type === motion.type && near(oldMotion.amount, motion.amount);
        clip = { ...clip, effect: sameEffect ? existing?.effect : effect.type === 'none' ? undefined : effect, motion: sameMotion ? existing?.motion : motion.type === 'none' ? undefined : motion };
        if (clip.effect === undefined) delete clip.effect;
        if (clip.motion === undefined) delete clip.motion;
        if (existing) {
            const keys = changedKeys(comparableClip(existing), comparableClip(clip));
            if (keys.length === 0) clip = existing;
            else changes.push(`素材片段 ${shortId(existing.id)}：${[...new Set(keys.map(key => CLIP_FIELD_LABELS[key as string] ?? String(key)))].join('、')}`);
        } else {
            changes.push(`加了素材片段 ${shortId(clip.id)}（「${asset.name}」）`);
        }
        clipOrigin.set(clip, node);
        clips.push(clip);
    });
    // 只写了新片段（没有 id、也没写 clips none）：加在原来的后面。
    if (!doc.clipsNone && doc.clips.every(node => !node.id)) clips.unshift(...project.assetClips);
    project.assetClips.filter(clip => !clips.includes(clip) && !clips.some(other => other.id === clip.id)).forEach(clip => changes.push(`删除了素材片段 ${shortId(clip.id)}`));
    const kept = clips.filter(clip => project.assetClips.includes(clip));
    if (kept.map(clip => clip.id).join() !== project.assetClips.filter(clip => clips.includes(clip)).map(clip => clip.id).join()) changes.push('调整了素材片段的先后');
    if (clips.length === project.assetClips.length && clips.every((clip, i) => clip === project.assetClips[i])) return project;
    return { ...project, assetClips: clips };
};

const applyBackgrounds = (doc: ScriptDoc, project: LumiProject, env: ScriptEnv, shaped: LumiProgram, resolved: Resolved, diagnostics: Diagnostic[], changes: string[]): LumiProject => {
    if (doc.backgrounds.length === 0 && !doc.backgroundsNone) return project;
    const clips: BackgroundClip[] = [];
    const toSource = (source: SourceNode, keep: BackgroundSource | null): BackgroundSource | null => {
        if (source.type === 'image' || source.type === 'video') {
            const asset = resolved.assets.get(source.asset);
            if (!asset) return null;
            if (source.type === 'image') return keep?.type === 'image' && keep.assetId === asset.id ? keep : { type: 'image', assetId: asset.id };
            const wanted: BackgroundSource = { type: 'video', assetId: asset.id, offset: source.offset, loop: source.loop };
            return keep?.type === 'video' && keep.assetId === asset.id && keep.loop === source.loop && near(keep.offset, source.offset) ? keep : wanted;
        }
        if (source.type === 'gradient') {
            return keep?.type === 'gradient' && keep.from === source.from && keep.to === source.to && Math.round(keep.angle) === Math.round(source.angle) ? keep : source;
        }
        return keep?.type === source.type ? keep : source;
    };
    doc.backgrounds.forEach(node => {
        const target = resolved.backgrounds.get(node);
        if (!target) return;
        const existing = target === 'new' ? null : target;
        const f = node.fields;
        const timing = toTiming(f.at!, existing?.timing ?? null, doc, env, shaped, resolved, diagnostics);
        const source = toSource(f.source!.value, existing?.source ?? null);
        if (!timing || !source) return;
        let clip: BackgroundClip = settle({
            id: existing?.id ?? newId(),
            source,
            timing: existing && sameTiming(existing.timing, timing) ? existing.timing : timing,
            ...DEFAULT_BACKGROUND_LOOK,
            ...(f.fit ? { fit: f.fit.value } : {}),
            ...(f.kenBurns ? { kenBurns: f.kenBurns.value } : {}),
            ...(f.blur ? { blur: f.blur.value } : {}),
            ...(f.dim ? { dim: f.dim.value } : {}),
            ...(f.fade ? { fadeIn: f.fade.value[0], fadeOut: f.fade.value[1] } : {}),
        }, existing, { kenBurns: 0.006, blur: 0.06, dim: 0.006, fadeIn: 0.006, fadeOut: 0.006 });
        if (existing) {
            const keys = changedKeys(existing, clip);
            if (keys.length === 0) clip = existing;
            else changes.push(`背景片段 ${shortId(existing.id)}：${[...new Set(keys.map(key => BACKGROUND_FIELD_LABELS[key as string] ?? String(key)))].join('、')}`);
        } else {
            changes.push(`加了背景片段 ${shortId(clip.id)}`);
        }
        clipOrigin.set(clip, node);
        clips.push(clip);
    });
    if (!doc.backgroundsNone && doc.backgrounds.every(node => !node.id)) clips.unshift(...project.backgroundClips);
    project.backgroundClips.filter(clip => !clips.some(other => other.id === clip.id)).forEach(clip => changes.push(`删除了背景片段 ${shortId(clip.id)}`));
    const order = (list: BackgroundClip[], other: BackgroundClip[]) => list.filter(clip => other.some(item => item.id === clip.id)).map(clip => clip.id).join();
    if (order(clips, project.backgroundClips) !== order(project.backgroundClips, clips)) changes.push('调整了背景片段的叠放顺序');
    if (clips.length === project.backgroundClips.length && clips.every((clip, i) => clip === project.backgroundClips[i])) return project;
    return { ...project, backgroundClips: clips };
};

