// src/script/check.ts
// 第二阶段：对照工程与风格包注册表检查语法树——包 / 风格 / 转场 / 族 / 素材 / 片段存不存在，
// 段落的行范围是否连续地覆盖全部歌词，歌词行、逐字时间、分词对不对得上。不需要重编。
// 能确定的名称都在这里查；镜头的组件槽要等编出镜头（知道它属于哪个包）才能查，见 apply.ts。
import type { LumiProgram } from '@/compiler/types';
import type { AssetClip } from '@/core/assets/clips';
import type { BackgroundClip } from '@/core/assets/background';
import { isValidWordSegmentation, repairWordSegmentation } from '@/core/lyrics/wordSegmentation';
import { unitsMatchText } from '@/core/lyrics/wordTiming';
import type { Line } from '@/core/types';
import { allFamilies, allStyles, allTransitions, borrowableTypographies, findPack, getStyle, getTransition, listPacks } from '@/packs/registry';
import type { LibraryAsset } from '@/project/assets';
import type { LumiProject } from '@/project/types';
import { error, replaceFix, unknownName, warning, type Diagnostic, type Fix, type Span } from './diagnostics';
import type { At, BackgroundNode, ClipNode, LyricLineNode, ParagraphNode, ScriptDoc, TimingNode } from './parse';
import { quote, shortId } from './syntax';

export interface CheckInput {
    project: LumiProject;
    program: LumiProgram;
    sourceLines: Line[] | null;
}

/** 检查时顺便解析出来的引用（应用时直接用）。 */
export interface Resolved {
    /** 每个段落块的行范围（行号 0 起，含两端）；范围写错的段落不在这里。 */
    ranges: Map<ParagraphNode, { start: number; end: number }>;
    clips: Map<ClipNode, AssetClip | 'new'>;
    backgrounds: Map<BackgroundNode, BackgroundClip | 'new'>;
    assets: Map<At<string>, LibraryAsset>;
    /**
     * 写在换了风格的镜头上、却属于别的包的组件（多半是换包时留下的原来那个包的组件）。
     * 要对照镜头原来的样子才知道是不是留下的，放到应用时判断：是就去掉并提示，不是就报这条错误。
     */
    foreignComponents: Map<object, Diagnostic>;
}

const TOLERANCE = 0.011;

/** 按 id 前缀找唯一的一项。 */
export const byPrefix = <T extends { id: string }>(items: T[], prefix: string): T | null | 'ambiguous' => {
    const matches = items.filter(item => item.id.startsWith(prefix));
    if (matches.length > 1) return 'ambiguous';
    return matches[0] ?? null;
};

const packIds = () => listPacks().map(pack => pack.id);

export const checkScript = (doc: ScriptDoc, { project, program, sourceLines }: CheckInput): { diagnostics: Diagnostic[]; resolved: Resolved } => {
    const diagnostics: Diagnostic[] = [];
    const resolved: Resolved = { ranges: new Map(), clips: new Map(), backgrounds: new Map(), assets: new Map(), foreignComponents: new Map() };
    const lineCount = program.lines.length;

    const packCheck = (at: At<string> | null | undefined, allowAuto = false) => {
        if (!at || (allowAuto && at.value === 'auto') || findPack(at.value)) return;
        diagnostics.push(unknownName('LS201', at, `没有风格包 ${at.value}`, at.value, allowAuto ? [...packIds(), 'auto'] : packIds()));
    };

    // ---- 全曲设置
    if (doc.direction?.value.mode === 'single') packCheck(doc.direction.value.pack);
    doc.mix.forEach(item => packCheck(item.pack));

    // ---- 段落
    if (doc.paragraphsAuto && doc.paragraphs.length > 0) {
        diagnostics.push(error('LS314', doc.paragraphsAuto, 'paragraphs auto 与段落块不能同时写', {
            hint: 'paragraphs auto 把分段与段落编排全部交回自动；想逐段写就删掉这一行',
            related: [{ line: doc.paragraphs[0].line, message: '第一个段落块' }],
        }));
    }
    const writtenLines = new Map<number, LyricLineNode>();
    doc.paragraphs.forEach((paragraph, index) => {
        const label = `第 ${index + 1} 段`;
        // 范围：lines a..b，或者块里的 line 语句（要连续）。
        const numbers = paragraph.lyricLines.map(node => node.number.value);
        let range: { start: number; end: number } | null = null;
        if (paragraph.lines) {
            range = { start: paragraph.lines.value.from - 1, end: paragraph.lines.value.to - 1 };
            const outside = paragraph.lyricLines.find(node => node.number.value - 1 < range!.start || node.number.value - 1 > range!.end);
            if (outside) diagnostics.push(error('LS306', outside.number, `第 ${outside.number.value} 行不在这一段的 lines ${paragraph.lines.value.from}..${paragraph.lines.value.to} 里`, { related: [{ line: paragraph.lines.line, message: '这一段的行范围' }] }));
        } else if (numbers.length > 0) {
            const sorted = [...paragraph.lyricLines].sort((a, b) => a.number.value - b.number.value);
            const gap = sorted.findIndex((node, i) => i > 0 && node.number.value !== sorted[i - 1].number.value + 1 && node.number.value !== sorted[i - 1].number.value);
            if (gap > 0) {
                const before = sorted[gap - 1].number.value;
                diagnostics.push(error('LS306', sorted[gap].number, `${label}的 line 不连续：第 ${before + 1}${sorted[gap].number.value - 1 > before + 1 ? `..${sorted[gap].number.value - 1}` : ''} 行没写`, {
                    hint: '一段里的 line 要一行接一行；只想写范围可以用 lines a..b',
                }));
            } else {
                range = { start: sorted[0].number.value - 1, end: sorted.at(-1)!.number.value - 1 };
            }
        } else {
            diagnostics.push(error('LS305', paragraph.head, `${label}没有写包含哪些歌词行`, { hint: '写 line 语句，或者 lines a..b' }));
        }
        if (range) resolved.ranges.set(paragraph, range);

        packCheck(paragraph.pack, true);
        if (paragraph.families && Array.isArray(paragraph.families.value)) {
            const known = allFamilies().map(family => family.id);
            paragraph.families.value.forEach((family, i) => {
                if (known.includes(family)) return;
                // families 的每个族各自的位置：从整条的起点按空格推。
                const offset = (paragraph.families!.value as string[]).slice(0, i).reduce((sum, item) => sum + item.length + 1, 0);
                const at: Span = { line: paragraph.families!.line, from: paragraph.families!.from + offset, to: paragraph.families!.from + offset + family.length };
                diagnostics.push(unknownName('LS204', at, `没有镜头族 ${family}`, family, known));
            });
        }
        const transition = paragraph.transition;
        if (transition && !['none', 'auto'].includes(transition.value) && !getTransition(transition.value)) {
            diagnostics.push(unknownName('LS203', transition, `没有转场 ${transition.value}`, transition.value, [...allTransitions().map(item => item.id), 'none', 'auto']));
        }

        // 镜头：序号不重复；写了风格的，风格存在、组件槽属于那个包。
        const seenShots = new Map<number, number>();
        paragraph.shots.forEach(shot => {
            const previous = seenShots.get(shot.number.value);
            if (previous !== undefined) diagnostics.push(error('LS318', shot.number, `${label}的第 ${shot.number.value} 个镜头写了两遍`, { related: [{ line: previous, message: '前面写过' }] }));
            seenShots.set(shot.number.value, shot.line);
            if (!shot.style) return;
            const style = getStyle(shot.style.value);
            if (!style) {
                diagnostics.push(unknownName('LS202', shot.style, `没有风格 ${shot.style.value}`, shot.style.value, allStyles().map(item => item.id)));
                return;
            }
            shot.components.forEach(component => {
                const problem = componentProblem(style.pack, style.kind, component.slot, component.value);
                if (!problem) return;
                if (belongsToOtherPack(style.pack, component.slot.value, component.value.value)) resolved.foreignComponents.set(component, problem);
                else diagnostics.push(problem);
            });
        });

        // 歌词行
        paragraph.lyricLines.forEach(node => {
            if (!sourceLines) {
                diagnostics.push(error('LS313', node.number, '工程没有歌词文件（纯音乐的 ♪ 行不能改），段落用 lines a..b 写范围'));
                return;
            }
            const number = node.number.value;
            if (number > lineCount) {
                diagnostics.push(error('LS303', node.number, `只有 ${lineCount} 行歌词`));
                return;
            }
            const previous = writtenLines.get(number);
            if (previous) diagnostics.push(error('LS304', node.number, `第 ${number} 行写了两遍`, { related: [{ line: previous.line, message: '前面写过' }] }));
            writtenLines.set(number, node);
            lyricLineProblems(node).forEach(item => diagnostics.push(item));
        });
    });

    // 所有段落连续地覆盖全部歌词。
    if (doc.paragraphs.length > 0 && doc.paragraphs.every(paragraph => resolved.ranges.has(paragraph))) {
        let expected = 0;
        doc.paragraphs.forEach((paragraph, index) => {
            const range = resolved.ranges.get(paragraph)!;
            const at: Span = paragraph.lines ?? paragraph.lyricLines[0]?.number ?? paragraph.head;
            const previous = doc.paragraphs[index - 1];
            const related = previous ? [{ line: previous.line, message: `上一段到第 ${resolved.ranges.get(previous)!.end + 1} 行` }] : undefined;
            if (range.start > expected) {
                diagnostics.push(error('LS301', at, `第 ${expected + 1}${range.start - 1 > expected ? `..${range.start}` : ''} 行不在任何段落里`, {
                    hint: previous ? '把上一段延长到这里，或者这一段从更前面开始' : '第一段要从第 1 行开始',
                    related,
                }));
            } else if (range.start < expected) {
                diagnostics.push(error('LS302', at, `和上一段重叠：第 ${range.start + 1}${expected - 1 > range.start ? `..${expected}` : ''} 行写了两次`, { related }));
            }
            if (range.end >= lineCount) diagnostics.push(error('LS303', at, `只有 ${lineCount} 行歌词，这一段写到了第 ${range.end + 1} 行`));
            expected = Math.max(expected, range.end + 1);
        });
        if (expected < lineCount) {
            const last = doc.paragraphs.at(-1)!;
            diagnostics.push(error('LS301', last.lines ?? last.head, `第 ${expected + 1}..${lineCount} 行不在任何段落里`, { hint: '把最后一段延长到最后一行，或者再加一段' }));
        }
    }
    if (doc.paragraphs.length > 1) {
        const last = doc.paragraphs.at(-1)!;
        if (last.transition && last.transition.value !== 'auto') {
            diagnostics.push(warning('LS319', last.transition, '最后一段没有出场转场，这一行不起作用'));
        }
    }

    // ---- 片段
    const paragraphCount = doc.paragraphs.length > 0 ? doc.paragraphs.length : program.paragraphs.length;
    const timingCheck = (timing: At<TimingNode> | undefined, isNew: boolean) => {
        if (!timing) return;
        const value = timing.value;
        if (value.type === 'missing' && isNew) diagnostics.push(error('LS309', timing, '新片段不能写 at missing', { hint: '写 song / 时间段 / lines a..b / paragraph N / shot P.S' }));
        if (value.type === 'lines' && value.to > lineCount) diagnostics.push(error('LS309', timing, `只有 ${lineCount} 行歌词`));
        if ((value.type === 'paragraph' || value.type === 'shot') && value.paragraph > paragraphCount) diagnostics.push(error('LS309', timing, `只有 ${paragraphCount} 段`));
    };
    const assetCheck = (at: At<string> | undefined, kind: 'image' | 'video') => {
        if (!at) return;
        const byId = byPrefix(project.assets, at.value);
        const asset = byId === null ? project.assets.find(item => item.name === at.value) ?? project.assets.find(item => item.name.toLowerCase() === at.value.toLowerCase()) ?? null : byId;
        if (asset === 'ambiguous') {
            diagnostics.push(error('LS209', at, `有多个素材的 id 以 ${at.value} 开头，多写几位`));
        } else if (!asset) {
            const candidates = project.assets.filter(item => item.kind === kind);
            diagnostics.push(unknownName('LS208', at, `素材库里没有 ${at.value}`, at.value, candidates.map(item => item.name), candidates.length === 0
                ? `素材库里还没有${kind === 'video' ? '视频' : '图片'}，先在「素材库」里上传`
                : `可以写：${candidates.map(item => `${shortId(item.id)}（${quote(item.name)}）`).join('、')}`));
        } else if (asset.kind !== kind) {
            diagnostics.push(error('LS210', at, kind === 'image' ? `「${asset.name}」是视频，视频只能用作背景（background 的 source video）` : `「${asset.name}」是图片，写成 source image`));
        } else {
            resolved.assets.set(at, asset);
        }
    };
    const identify = <T extends { id: string }>(node: ClipNode | BackgroundNode, items: T[], seen: Map<string, number>, what: string): T | 'new' | null => {
        if (!node.id) return 'new';
        const found = byPrefix(items, node.id.value);
        if (found === 'ambiguous') {
            diagnostics.push(error('LS212', node.id, `有多个${what}的 id 以 ${node.id.value} 开头，多写几位`));
            return null;
        }
        if (!found) {
            diagnostics.push(error('LS211', node.id, `没有${what} ${node.id.value}`, {
                hint: `新${what}不写 id：${node.head.value} {`,
                fixes: [replaceFix('去掉 id（作为新片段）', { line: node.id.line, from: node.head.to, to: node.id.to }, '')].filter((item): item is Fix => item !== null),
            }));
            return null;
        }
        const previous = seen.get(found.id);
        if (previous !== undefined) {
            diagnostics.push(error('LS307', node.id, `这个${what}写了两遍`, { related: [{ line: previous, message: '前面写过' }] }));
            return null;
        }
        seen.set(found.id, node.line);
        return found;
    };

    const seenClips = new Map<string, number>();
    doc.clips.forEach(node => {
        const target = identify(node, project.assetClips, seenClips, '素材片段');
        if (target) resolved.clips.set(node, target);
        const missing = [!node.fields.asset && 'asset', !node.fields.at && 'at'].filter(Boolean);
        if (missing.length > 0) diagnostics.push(error('LS308', node.head, `素材片段要写 ${missing.join(' 和 ')}`));
        assetCheck(node.fields.asset, 'image');
        timingCheck(node.fields.at, target === 'new');
    });
    const seenBackgrounds = new Map<string, number>();
    doc.backgrounds.forEach(node => {
        const target = identify(node, project.backgroundClips, seenBackgrounds, '背景片段');
        if (target) resolved.backgrounds.set(node, target);
        const missing = [!node.fields.source && 'source', !node.fields.at && 'at'].filter(Boolean);
        if (missing.length > 0) diagnostics.push(error('LS308', node.head, `背景片段要写 ${missing.join(' 和 ')}`));
        const source = node.fields.source?.value;
        if (source && (source.type === 'image' || source.type === 'video')) assetCheck(source.asset, source.type);
        timingCheck(node.fields.at, target === 'new');
    });
    return { diagnostics, resolved };
};

/** 别的包有这个组件槽与取值（借用的排版不细查）。 */
const belongsToOtherPack = (packId: string, slot: string, value: string) => listPacks().some(pack => pack.id !== packId
    && pack.componentSlots?.some(def => def.id === slot && (def.options.some(option => option.id === value) || (slot === 'typography' && value.includes('/')))));

/** 组件槽与取值能不能用在 pack/kind 这个风格的镜头上；可以时返回 null。 */
export const componentProblem = (packId: string, kind: string, slot: At<string>, value: At<string>): Diagnostic | null => {
    const pack = findPack(packId);
    const slots = pack?.componentSlots ?? [];
    const def = slots.find(item => item.id === slot.value);
    if (!def) {
        return slots.length === 0
            ? error('LS205', slot, `${packId} 的镜头没有可以替换的组件`)
            : unknownName('LS205', slot, `${packId} 的镜头没有组件槽 ${slot.value}`, slot.value, slots.map(item => item.id));
    }
    if (value.value === 'auto' || def.options.some(option => option.id === value.value)) return null;
    if (slot.value === 'typography' && value.value.includes('/')) {
        const borrowable = borrowableTypographies(packId, kind).map(option => option.value);
        if (borrowable.includes(value.value)) return null;
        return unknownName('LS207', value, `${packId}/${kind} 借不了排版 ${value.value}`, value.value, borrowable,
            borrowable.length === 0 ? '这个构图没有留出文字区域，借不了别的包的排版' : undefined);
    }
    return unknownName('LS206', value, `${slot.value} 没有选项 ${value.value}`, value.value, [...def.options.map(option => option.id), 'auto']);
};

/** 一行歌词自身的问题：逐字时间拼不回文字、越界、顺序；分词拼不回文字。 */
const lyricLineProblems = (node: LyricLineNode): Diagnostic[] => {
    const problems: Diagnostic[] = [];
    const text = node.text.value.replace(/[\r\n]+/g, ' ');
    if (!text.trim()) problems.push(error('LS310', node.text, '歌词不能是空的'));
    if (node.words) {
        const units = node.words.map(word => ({ text: word.text.value }));
        if (!unitsMatchText(text, units)) {
            problems.push(error('LS310', node.text, `逐字时间拼不出这一行的文字：${quote(node.words.map(word => word.text.value).join(''))}`, {
                hint: '改字后逐字时间也要跟着改；删掉 word 行就按改字规则重新分配（没变的字保留时间）',
                related: [{ line: node.words[0].text.line, message: '第一个 word' }],
            }));
        }
        const { start, end } = node.range.value;
        node.words.forEach((word, i) => {
            const range = word.range.value;
            if (range.start < start - TOLERANCE || range.end > end + TOLERANCE) {
                problems.push(error('LS311', word.range, '逐字时间超出了这一行的时间', { related: [{ line: node.line, message: `这一行是 ${node.range.value.start.toFixed(2)}–${node.range.value.end.toFixed(2)} 秒` }] }));
            } else if (i > 0 && range.start < node.words![i - 1].range.value.end - TOLERANCE) {
                problems.push(error('LS311', word.range, '逐字时间和前一个字重叠（要按顺序、不重叠）'));
            }
        });
    }
    if (node.parts && !isValidWordSegmentation(text, node.parts.value)) {
        const repaired = repairWordSegmentation(node.parts.value, text);
        problems.push(error('LS312', node.parts, `分词拼不出这一行的文字：${quote(node.parts.value.join(''))}`, {
            hint: '改字后分词也要跟着改，或者删掉 parts 用自动分词',
            fixes: [{
                label: '按新文字自动修复分词',
                edits: [{ line: node.parts.line, from: node.parts.from, to: node.parts.to, insert: repaired.map(quote).join(' ') }],
            }],
        }));
    }
    return problems;
};
