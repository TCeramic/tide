// src/agent/tools.ts
// 给外部 agent 用的工具与提示词，与传输方式无关（本地 MCP 桥、浏览器原生 WebMCP 都用这一份）。
// 返回值沿用 MCP 的 content 格式。写操作都走已有的编辑函数：进撤销栈，并在「输出」里留一条记录。
import { applySceneDirection, buildSceneDirectionRequest } from '@/ai/actions';
import { sanitizeThemeResult, THEME_SCHEMA } from '@/ai/client';
import {
    buildSceneDirectionPrompt,
    sanitizeSceneDirection,
    SCENE_DIRECTION_SCHEMA,
    SCENE_DIRECTION_SYSTEM_PROMPT,
} from '@/ai/sceneDirection';
import { buildThemeSourcePrompt, THEME_GENERATION_PROMPT_PREFIX } from '@/ai/themePrompt';
import {
    SEGMENTATION_JSON_SCHEMA,
    buildSegmentationSourcePrompt,
    buildSegmentationSystemPrompt,
} from '@/ai/vendor/lyricSegmentationPrompt.mjs';
import { commitScript, commitSettings, currentScript, scriptVersion } from '@/script/actions';
import { applyScript } from '@/script/apply';
import { formatDiagnostic, type Diagnostic } from '@/script/diagnostics';
import { printSettings } from '@/script/settings';
import { SCRIPT_REFERENCE, SCRIPT_SKILL } from './skill';
import { ASSET_SLOTS, CLIP_ANIMATIONS, FOLLOW_MODES, resolveAssetClips, type AssetBlend, type AssetClip, type AssetSlot, type ClipAnimationType, type ClipTiming, type FollowMode } from '@/core/assets/clips';
import { PARAGRAPH_KINDS, type LumiParagraph, type LumiProgram, type LumiShot } from '@/compiler/types';
import { isInterludeLine } from '@/core/lyrics/parserCore';
import { isValidWordSegmentation } from '@/core/lyrics/wordSegmentation';
import { ExportCancelled, exportVideo, type ExportFormat } from '@/export/exporter';
import { buildProjectExportInput, exportFileName, exportSizeFor } from '@/export/projectExport';
import type { ComponentSlotDef, FamilyDef, Mood, StyleDef, StylePack } from '@/packs/contract';
import { borrowableTypographies, findPack, getStyle, getTransition, listPacks } from '@/packs/registry';
import {
    lockShotStyle,
    patchParagraphDirection,
    setParagraphTransition,
    setShotComponent,
    unlockShotStyle,
    type DirectionPatch,
} from '@/project/edits';
import { useSession } from '@/project/session';
import { updateProject, useProjectStore } from '@/project/store';
import { addAssetClip, addBackgroundClip, isInTemperaPool, removeAssetClip, removeBackgroundClip, updateAssetClip, updateBackgroundClip } from '@/project/assets';
import { resolveBackgroundClips, type BackgroundClip, type BackgroundSource } from '@/core/assets/background';
import { mergeWithPrevious, moveParagraphStart, resetParagraphStructure, setParagraphKind, splitParagraphAt } from '@/project/structure';
import { normalizeTypography } from '@/project/typography';
import { segmentationRepairFor, withLineBounds, withLineText, withLineTranslation, withLineWords, withoutLineEdit, withoutLineText, withoutLineTiming, withoutLineTranslation, withRepairedSegmentation } from '@/project/lyrics';
import { editableUnits } from '@/core/lyrics/wordEditing';
import { getAgentState, getPreviewKernel, getScriptEnv } from './host';

export type ToolContent =
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string };

export interface ToolResult {
    content: ToolContent[];
    /** MCP 的结构化结果（与文本里的 JSON 相同；数组包在一个键下，MCP 要求是对象）。 */
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
}

export interface AgentTool {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    /** 只读工具不改工程。 */
    readOnly: boolean;
    run: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
}

export interface AgentPrompt {
    name: string;
    title: string;
    description: string;
    build: () => { description: string; text: string };
}

/** 工具调用的记录（「Agent」面板与「输出」里显示）。 */
export type AgentActivityListener = (entry: { tool: string; ok: boolean; summary: string }) => void;
const listeners = new Set<AgentActivityListener>();
export const onAgentActivity = (listener: AgentActivityListener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export class ToolInputError extends Error {}

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });
/** JSON 结果：文本里是缩进的 JSON，同时作为 structuredContent；数组放在 `arrayKey` 下。 */
const json = (value: unknown, arrayKey = 'items'): ToolResult => ({
    ...text(JSON.stringify(value, null, 2)),
    structuredContent: Array.isArray(value) ? { [arrayKey]: value } : value as Record<string, unknown>,
});

// ---------------------------------------------------------------------------------------------
// 参数

const num = (args: Record<string, unknown>, key: string, options: { min?: number; max?: number } = {}): number => {
    const value = args[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new ToolInputError(`${key} 必须是数字`);
    if (options.min !== undefined && value < options.min) throw new ToolInputError(`${key} 不能小于 ${options.min}`);
    if (options.max !== undefined && value > options.max) throw new ToolInputError(`${key} 不能大于 ${options.max}`);
    return value;
};

const optNum = (args: Record<string, unknown>, key: string, options: { min?: number; max?: number } = {}) => (
    args[key] === undefined ? undefined : num(args, key, options)
);

const str = (args: Record<string, unknown>, key: string, optional = false) => {
    const value = args[key];
    if (value === undefined && optional) return undefined;
    if (typeof value !== 'string' || !value) throw new ToolInputError(`${key} 必须是非空字符串`);
    return value;
};

const paragraphAt = (program: LumiProgram, index: number): LumiParagraph => {
    const paragraph = program.paragraphs[index];
    if (!paragraph) throw new ToolInputError(`没有第 ${index} 段（共 ${program.paragraphs.length} 段，从 0 开始）`);
    return paragraph;
};

const shotAt = (program: LumiProgram, paragraphIndex: number, shotIndex: number): LumiShot => {
    const paragraph = paragraphAt(program, paragraphIndex);
    const shot = paragraph.shots[shotIndex];
    if (!shot) throw new ToolInputError(`第 ${paragraphIndex} 段没有第 ${shotIndex} 个镜头（共 ${paragraph.shots.length} 个）`);
    return shot;
};

const isLyricLine = (value: string) => value.trim().length > 0 && value !== '......' && value !== '♪';

// ---------------------------------------------------------------------------------------------
// 描述

const describeShot = (program: LumiProgram, shot: LumiShot, index: number) => ({
    index,
    style: shot.style,
    locked: shot.locked,
    startTime: round(shot.startTime),
    endTime: round(shot.endTime),
    isBridge: shot.isBridge,
    text: shot.lineIndices.map(i => program.lines[i]?.line.fullText).filter(Boolean).join(' / '),
    components: shot.components,
    lockedComponents: shot.lockedComponents,
    ...(shot.borrowedText ? { borrowedTypography: `${shot.borrowedText.pack}/${shot.borrowedText.typography}` } : {}),
});

const describeParagraph = (program: LumiProgram, paragraph: LumiParagraph) => ({
    index: paragraph.index,
    kind: paragraph.kind,
    kindManual: paragraph.kindManual,
    boundary: paragraph.boundary,
    merged: paragraph.merged,
    startTime: round(paragraph.startTime),
    endTime: round(paragraph.endTime),
    lines: paragraph.lineIndices,
    direction: paragraph.direction,
    transitionOut: paragraph.transitionOut ? { id: paragraph.transitionOut.id, source: paragraph.transitionOut.source } : null,
    shots: paragraph.shots.map((shot, index) => describeShot(program, shot, index)),
});

const round = (value: number) => Math.round(value * 1000) / 1000;

// ---------------------------------------------------------------------------------------------
// 风格目录

const MOODS: Mood[] = ['quiet', 'neutral', 'loud'];

interface StyleFilter {
    /** 族 id 或族名（小写）。 */
    family?: string;
    mood?: Mood;
    /** 小写的检索词，全部命中才算。 */
    keyword?: string[];
}

const styleMatches = (pack: StylePack, style: StyleDef, filter: StyleFilter) => {
    if (filter.family) {
        const label = pack.families.find(family => family.id === style.family)?.label.toLowerCase();
        if (style.family.toLowerCase() !== filter.family && label !== filter.family) return false;
    }
    if (filter.mood && style.mood !== filter.mood) return false;
    if (filter.keyword?.length) {
        const haystack = [style.id, style.label ?? '', style.description ?? '', ...(style.keywords ?? [])].join('\n').toLowerCase();
        if (!filter.keyword.every(term => haystack.includes(term))) return false;
    }
    return true;
};

const describeFamily = (family: FamilyDef) => ({ id: family.id, label: family.label, ...(family.description ? { description: family.description } : {}) });

const describeStyle = (style: StyleDef) => ({
    id: style.id,
    family: style.family,
    mood: style.mood,
    ...(style.label ? { label: style.label } : {}),
    ...(style.description ? { description: style.description } : {}),
    ...(style.keywords?.length ? { keywords: style.keywords } : {}),
});

const describeStyleBrief = (style: StyleDef) => ({
    id: style.id,
    ...(style.label ? { label: style.label } : {}),
    family: style.family,
    mood: style.mood,
    ...(style.description ? { description: style.description } : {}),
});

const describeSlot = (slot: ComponentSlotDef) => ({
    id: slot.id,
    label: slot.label,
    ...(slot.description ? { description: slot.description } : {}),
    options: slot.options.map(option => option.id),
    optionDetails: slot.options.map(option => ({ id: option.id, label: option.label, ...(option.description ? { description: option.description } : {}) })),
});

const describeStyleDetail = (pack: StylePack, style: StyleDef) => {
    const family = pack.families.find(item => item.id === style.family);
    return {
        ...describeStyle(style),
        pack: pack.id,
        kind: style.kind,
        familyLabel: family?.label ?? style.family,
        ...(family?.description ? { familyDescription: family.description } : {}),
        componentSlots: pack.componentSlots?.map(describeSlot) ?? [],
        borrowableTypographies: borrowableTypographies(pack.id, style.kind).map(item => item.value),
    };
};

/**
 * 目录里的跨包借排版：能借哪些排版只取决于宿主风格有没有文字区，同一个包里各风格的列表相同，
 * 所以按包给一份（逐风格列出会让全目录膨胀几倍），另列出这次列出的风格里不能借的。
 */
const borrowingOf = (pack: StylePack, styles: readonly StyleDef[]) => {
    const lists = styles.map(style => ({ kind: style.kind, values: borrowableTypographies(pack.id, style.kind).map(item => item.value) }));
    const options = [...new Set(lists.flatMap(item => item.values))];
    const without = lists.filter(item => item.values.length === 0).map(item => item.kind);
    return {
        borrowableTypographies: options,
        ...(options.length > 0 && without.length > 0 ? { stylesWithoutBorrowing: without } : {}),
    };
};

// ---------------------------------------------------------------------------------------------
// 截帧

const MAX_FRAMES = 6;

/** render_frame 要截的时刻：times（最多 MAX_FRAMES 个）或单个 time。 */
const frameTimes = (args: Record<string, unknown>): number[] => {
    if (args.times === undefined) return [num(args, 'time', { min: 0 })];
    if (!Array.isArray(args.times) || args.times.length === 0) throw new ToolInputError('times 必须是非空的数字数组');
    if (args.times.length > MAX_FRAMES) throw new ToolInputError(`times 最多 ${MAX_FRAMES} 个`);
    return args.times.map((value, index) => num({ [`times[${index}]`]: value }, `times[${index}]`, { min: 0 }));
};

/**
 * 截帧期间借用播放头：记下原来的位置（在播就先暂停），fn 里随意 seek，结束后（出错也一样）
 * 放回原处、恢复播放。暂停时 seek 回去会让预览重画原来那一帧。
 */
const withPlayheadRestored = async <T>(fn: (seek: (time: number) => void) => Promise<T>): Promise<T> => {
    const { clock, pause, play, seek } = await import('@/app/playback');
    const previous = clock.get();
    const wasPlaying = !clock.paused;
    if (wasPlaying) pause();
    try {
        return await fn(seek);
    } finally {
        seek(previous);
        if (wasPlaying) play();
    }
};

// ---------------------------------------------------------------------------------------------
// 写操作的公共部分

const done = (tool: string, summary: string, extra?: unknown): ToolResult => {
    listeners.forEach(listener => listener({ tool, ok: true, summary }));
    return extra === undefined ? text(summary) : json({ result: summary, ...(extra as object) });
};

/** 诊断给 agent 的样子：行列从 1 起，快速修复写成替换文字。 */
const describeDiagnostic = (item: Diagnostic) => ({
    line: item.line,
    ...(item.from !== undefined ? { column: item.from + 1 } : {}),
    code: item.code,
    severity: item.severity,
    message: item.message,
    ...(item.hint ? { hint: item.hint } : {}),
    ...(item.related?.length ? { related: item.related.map(related => ({ line: related.line, message: related.message })) } : {}),
    ...(item.fixes?.length ? { fixes: item.fixes.map(fix => ({ label: fix.label, edits: fix.edits.map(edit => ({ line: edit.line, column: edit.from + 1, endColumn: edit.to + 1, text: edit.insert })) })) } : {}),
});

const invalidAfterWrite = () => {
    const { program, lyrics } = getAgentState();
    return { invalidOps: program.invalidOps.length, invalidLyricEdits: lyrics.invalidEdits.length };
};


/** 从参数里挑出素材片段的外观字段（只接受合法值）。 */
const clipPatch = (args: Record<string, unknown>): Partial<AssetClip> => {
    const patch: Partial<AssetClip> = {};
    if (typeof args.slot === 'string' && ASSET_SLOTS.includes(args.slot as AssetSlot)) patch.slot = args.slot as AssetSlot;
    for (const key of ['x', 'y', 'scale', 'rotation', 'opacity', 'lead', 'tail'] as const) {
        if (typeof args[key] === 'number' && Number.isFinite(args[key])) patch[key] = args[key] as number;
    }
    if (patch.opacity !== undefined) patch.opacity = Math.min(1, Math.max(0, patch.opacity));
    if (patch.scale !== undefined) patch.scale = Math.max(0.02, patch.scale);
    if (typeof args.flipX === 'boolean') patch.flipX = args.flipX;
    if (typeof args.blend === 'string' && ['normal', 'add', 'multiply', 'screen'].includes(args.blend)) patch.blend = args.blend as AssetBlend;
    if (typeof args.follow === 'string' && FOLLOW_MODES.includes(args.follow as FollowMode)) patch.follow = args.follow as FollowMode;
    if (typeof args.followAmount === 'number' && Number.isFinite(args.followAmount)) patch.followAmount = Math.min(1, Math.max(0, args.followAmount));
    for (const key of ['enter', 'exit'] as const) {
        const value = args[key] as { type?: unknown; duration?: unknown } | undefined;
        if (value && CLIP_ANIMATIONS.includes(value.type as ClipAnimationType)) {
            patch[key] = { type: value.type as ClipAnimationType, duration: typeof value.duration === 'number' ? Math.max(0, value.duration) : 0.4 };
        }
    }
    return patch;
};

// ---------------------------------------------------------------------------------------------
// 工具

const PARAGRAPH = { type: 'integer', minimum: 0, description: '段落序号（从 0 开始，见 get_arrangement）' };
const SHOT = { type: 'integer', minimum: 0, description: '段内镜头序号（从 0 开始）' };

// ---------------------------------------------------------------------------------------------
// 生成说明：与内置 AI 功能相同的提示词 + 当前工程的原文 + 输出的 JSON Schema。agent 读完自己生成结果，
// 再用对应的工具写回。MCP 的 prompt 只能由用户触发、模型自己拿不到，所以同一份内容也做成只读工具。

const themeBrief = () => {
    const { program, project } = getAgentState();
    const lyricLines = program.lines.map(line => line.line.fullText).filter(isLyricLine);
    const pure = lyricLines.length === 0;
    const source = pure ? (project.meta.title || project.name) : lyricLines.join('\n');
    return `${THEME_GENERATION_PROMPT_PREFIX}\n\n${buildThemeSourcePrompt(source.slice(0, 2000), pure, project.meta.title)}\n\nOutput JSON Schema:\n${JSON.stringify(THEME_SCHEMA)}\n\nWhen done, call the tool set_theme with that object.`;
};

/** skipManual：跳过用户手动改过分词的行（与「AI」面板的「保留手动改过的行」相同）。 */
const segmentationBrief = (skipManual: boolean) => {
    const { program, project } = getAgentState();
    const manual = new Set(project.lyricEdits.segments.map(item => `${item.anchor.index}:${item.anchor.hash}`));
    const targets = program.lines
        .map((line, index) => ({ index, text: line.line.fullText, key: `${line.anchor.index}:${line.anchor.hash}` }))
        .filter(item => isLyricLine(item.text) && !(skipManual && manual.has(item.key)));
    if (targets.length === 0) return 'There are no lyric lines to segment (every line was segmented by hand, or the project has no lyrics). Nothing to do.';
    return `${buildSegmentationSystemPrompt()}\n\n${buildSegmentationSourcePrompt(targets.map(item => item.text))}\n\nOutput JSON Schema:\n${JSON.stringify(SEGMENTATION_JSON_SCHEMA)}\n\nThe rows correspond to lyric line indices ${JSON.stringify(targets.map(item => item.index))}. When done, call set_segmentation with lines: [{ index, parts }] using those indices.`;
};

const sceneDirectionBrief = () => {
    const { program, project } = getAgentState();
    const request = buildSceneDirectionRequest(program, project, useSession.getState().analysis);
    return `${SCENE_DIRECTION_SYSTEM_PROMPT}\n\n${buildSceneDirectionPrompt(request)}\n\nOutput JSON Schema:\n${JSON.stringify(SCENE_DIRECTION_SCHEMA)}\n\nWhen done, call apply_scene_direction with that object. You can check the result with render_frame.`;
};

export const AGENT_TOOLS: AgentTool[] = [
    {
        name: 'get_project',
        title: '工程概况',
        description: 'Overview of the open lumisynth project: song metadata, duration, lyric line count, paragraph count, current theme, direction settings, installed style packs and how many edits are invalid. `lineCounts` splits the lyric lines into sung lines and interlude placeholders (text "......"; they are lines too and count in every line index). `timeline` gives the audio duration, when the last sung line ends, when the last paragraph of the arrangement ends and `uncoveredTail` ({start, end} when the audio runs on past the arrangement, else null). Line, paragraph and shot indices of all tools start at 0 (`indexBase`); LumiScript and the editor count from 1. Call this first.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: () => {
            const { project, program, lyrics } = getAgentState();
            const session = useSession.getState();
            const theme = project.theme.dual[project.theme.variant];
            const sung = program.lines.filter(line => isLyricLine(line.line.fullText));
            const audioDuration = session.audioBuffer ? round(session.audioBuffer.duration) : null;
            const lyricsEnd = sung.length > 0 ? round(Math.max(...sung.map(line => line.line.endTime))) : null;
            const arrangementEnd = program.paragraphs.length > 0 ? round(Math.max(...program.paragraphs.map(paragraph => paragraph.endTime))) : null;
            // 音频比编排长出一截（尾奏没有编排）时给出这段范围；差不到 0.05 秒不算。
            const uncoveredTail = audioDuration !== null && audioDuration - (arrangementEnd ?? 0) > 0.05
                ? { start: arrangementEnd ?? 0, end: audioDuration }
                : null;
            return json({
                name: project.name,
                meta: project.meta,
                aspect: project.aspect,
                seed: project.seed,
                audio: session.audioBuffer ? { duration: round(session.audioBuffer.duration) } : null,
                lyrics: project.lyrics ? { fileName: project.lyrics.fileName, lines: program.lines.length, parseError: lyrics.error } : null,
                paragraphs: program.paragraphs.length,
                shots: program.paragraphs.reduce((sum, paragraph) => sum + paragraph.shots.length, 0),
                theme: { source: project.theme.source, variant: project.theme.variant, name: theme.name, colors: [theme.backgroundColor, theme.primaryColor, theme.accentColor, theme.secondaryColor] },
                typography: { lyrics: project.typography.lyrics, subtitles: project.typography.subtitles, uploadedFonts: project.typography.fonts.map(font => font.family) },
                direction: project.direction,
                packs: listPacks().map(pack => ({ id: pack.id, label: pack.label })),
                invalidOps: program.invalidOps.length,
                invalidLyricEdits: lyrics.invalidEdits.length,
                lineCounts: {
                    total: program.lines.length,
                    sung: sung.length,
                    interlude: program.lines.filter(line => isInterludeLine(line.line)).length,
                },
                timeline: { audioDuration, lyricsEnd, arrangementEnd, uncoveredTail },
                indexBase: 0,
            });
        },
    },
    {
        name: 'get_lyrics',
        title: '歌词',
        description: 'Lyric lines with index (from 0), timing, text, `interlude` (true for the "......" placeholder lines filling long instrumental gaps), translation (the subtitle shown under the lyric; null when there is none), word timing units ({text, startTime, endTime}), current word segmentation (manual or automatic) and what was edited by hand (text, translation, line timing, word timing; whether a manual segmentation no longer matches edited text).',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'integer', minimum: 0, description: 'First line index (default 0)' },
                to: { type: 'integer', minimum: 0, description: 'Last line index, inclusive (default: last line)' },
            },
        },
        readOnly: true,
        run: args => {
            const { program, project } = getAgentState();
            const from = optNum(args, 'from', { min: 0 }) ?? 0;
            const to = optNum(args, 'to', { min: 0 }) ?? program.lines.length - 1;
            const same = (anchor: { index: number; hash: string }, other: { index: number; hash: string }) => anchor.index === other.index && anchor.hash === other.hash;
            return json(program.lines.slice(from, to + 1).map((line, offset) => {
                const edit = project.lyricEdits.lines.find(item => same(item.anchor, line.anchor));
                const segments = project.lyricEdits.segments.find(item => same(item.anchor, line.anchor));
                return {
                    index: from + offset,
                    startTime: round(line.line.startTime),
                    endTime: round(line.line.endTime),
                    text: line.line.fullText,
                    interlude: isInterludeLine(line.line),
                    translation: line.line.translation ?? null,
                    words: editableUnits(line.line).map(unit => ({ text: unit.text, startTime: round(unit.startTime), endTime: round(unit.endTime) })),
                    manualSegmentation: Boolean(segments),
                    segmentationStale: Boolean(segments && segments.parts.join('') !== line.line.fullText),
                    edited: {
                        text: edit?.text !== undefined,
                        translation: edit?.translation !== undefined,
                        lineTiming: edit?.startTime !== undefined || edit?.endTime !== undefined,
                        wordTiming: Boolean(edit?.words),
                    },
                };
            }), 'lines');
        },
    },
    {
        name: 'get_arrangement',
        title: '编排',
        description: 'The compiled arrangement: paragraphs (kind, time, direction, outgoing transition) and their shots (style, time, text, components). Pass `paragraph` for a single one.',
        inputSchema: { type: 'object', properties: { paragraph: PARAGRAPH } },
        readOnly: true,
        run: args => {
            const { program } = getAgentState();
            const index = optNum(args, 'paragraph', { min: 0 });
            if (index !== undefined) return json(describeParagraph(program, paragraphAt(program, index)));
            return json({
                paragraphs: program.paragraphs.map(paragraph => describeParagraph(program, paragraph)),
                invalidOps: program.invalidOps.map(item => ({ type: item.op.type, reason: item.reason })),
            });
        },
    },
    {
        name: 'get_script',
        title: '剧本',
        description: 'The scene arrangement as a LumiScript v2 document (same as the editor’s 剧本 tab). It is the compiled arrangement written as editable directives: seed, direction, mix, shot-mixing, lyric-offset; one `paragraph <kind> { … }` block per paragraph with pack / energy / families / transition, its `line` statements (lyric text and timing) and one `shot N <style> { <slot> <value> … }` per shot; then background and clip blocks. Auto-chosen values are written too (commented `# 自动`); edit a value to pin it, add `locked` to pin the current value, remove `locked` or write `auto` to hand it back (`@ai` = pinned by AI). Unchangeable compile results (numbers, times, sung lyrics) are in "# " comments. Theme, fonts, aspect and tuning are not here (see get_settings). Call script_reference once for the full syntax. The last line carries the version to pass to apply_script (structuredContent: {version, script}).',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: () => {
            const script = currentScript(getScriptEnv());
            const version = scriptVersion(script);
            return { ...text(`${script}# version ${version}\n`), structuredContent: { version, script } };
        },
    },
    {
        name: 'script_reference',
        title: '剧本语法',
        description: 'The LumiScript v2 language reference (syntax, what each directive does, how partial scripts are applied, the diagnostic codes) and the recommended workflow for writing scripts. Read it before writing a script from scratch.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: () => text(`${SCRIPT_SKILL}\n\n---\n\n${SCRIPT_REFERENCE}`),
    },
    {
        name: 'check_script',
        title: '检查剧本',
        description: 'Dry-run a LumiScript: parse, check names against the installed packs and assets, compile, and report what apply_script would change — without changing the project. Diagnostics carry line, column, code, message, a hint and suggested fixes. Use it to iterate until there are no errors.',
        inputSchema: { type: 'object', properties: { script: { type: 'string', description: 'A whole script (from get_script, edited) or a partial one' } }, required: ['script'] },
        readOnly: true,
        run: args => {
            const result = applyScript(str(args, 'script')!, getScriptEnv());
            return json({ ok: result.ok, wouldChange: result.ok ? result.changes : [], diagnostics: result.diagnostics.map(describeDiagnostic) });
        },
    },
    {
        name: 'apply_script',
        title: '应用剧本',
        description: 'Apply a LumiScript to the project as one undo step. Declarative, section by section: what the script contains replaces that part of the project, what it leaves out stays as it is. Top-level settings (seed, direction, mix, shot-mixing, lyric-offset) each on their own; if any `paragraph` block is present, the blocks define the whole arrangement (segmentation by their lyric lines — they must cover every line in order —, kinds, pack/energy/families, transitions, shot styles and components: a value is pinned when it differs from the current arrangement or is marked `locked` / `@ai`, otherwise it stays automatic; anything not written is automatic — when writing from scratch, mark values to pin with `locked`); `line` statements set that lyric line (text, time, optional `parts` and `word` timing); if any `background` / `clip` block is present they are the complete list (blocks without an id are new; `clips none` / `backgrounds none` empty them). `paragraphs auto` hands the whole arrangement back. Pass the version from get_script when editing its output; if the project changed since, the call fails unless force is true. On errors nothing is applied and every problem is listed with its line and a hint.',
        inputSchema: {
            type: 'object',
            properties: {
                script: { type: 'string', description: 'The script: the whole edited get_script output, or a partial script with only the sections to set' },
                version: { type: 'string', description: 'The version line from get_script (omit for a partial script written from scratch)' },
                force: { type: 'boolean', description: 'Apply even if the project changed since get_script' },
            },
            required: ['script'],
        },
        readOnly: false,
        run: args => {
            const env = getScriptEnv();
            const script = str(args, 'script')!;
            const version = str(args, 'version', true);
            if (version && version !== scriptVersion(currentScript(env)) && args.force !== true) {
                throw new ToolInputError('剧本已过期：工程在 get_script 之后改过。重新 get_script 再改，或者传 force: true');
            }
            const result = commitScript(script, env);
            const warnings = result.diagnostics.filter(item => item.severity === 'warning').map(formatDiagnostic);
            if (!result.ok) {
                const errors = result.diagnostics.filter(item => item.severity === 'error');
                return { isError: true, content: [{ type: 'text', text: [`没有应用，剧本有 ${errors.length} 处错误：`, ...errors.map(formatDiagnostic)].join('\n') }] };
            }
            if (result.changes.length === 0) return text(['没有修改', ...warnings].join('\n'));
            return done('apply_script', result.changes.join('；'), { changes: result.changes, warnings, ...invalidAfterWrite() });
        },
    },
    {
        name: 'get_settings',
        title: '设置',
        description: 'Project settings that are not part of the scene arrangement, as JSON (same as the editor’s 设置 tab): name, meta, aspect, theme (variant, source, dark / light themes with colors, wordColors, lyricsIcons), typography, library (favorite / blocked styles), engineParams (segmentation and per-pack compile parameters) and tuning (kernel and per-pack look settings, with every field and its current value). The version to pass to apply_settings is returned separately (structuredContent: {version, settings}).',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: () => {
            const settings = printSettings(getAgentState().project);
            const version = scriptVersion(settings);
            return {
                content: [{ type: 'text', text: settings }, { type: 'text', text: `version ${version}` }],
                structuredContent: { version, settings: JSON.parse(settings) as Record<string, unknown> },
            };
        },
    },
    {
        name: 'apply_settings',
        title: '应用设置',
        description: 'Apply project settings JSON as one undo step. By default (mode "merge") only the fields you write change: the JSON is merged into the current settings key by key, so {"tuning": {"kernel": {"subtitles": {"opacity": 0.9}}}} changes that one value and keeps everything else; arrays (e.g. wordColors, library.favorites) and other values are replaced as a whole. Mode "replace" is the rule of the 设置 tab of the editor: each top-level section present is taken as a whole and missing fields inside it get their defaults. Unknown keys and wrong types are errors with the position and a suggestion; values clamped into range are reported as warnings.',
        inputSchema: {
            type: 'object',
            properties: {
                settings: { type: 'string', description: 'JSON text: only the fields to change (merge), or the get_settings output edited' },
                mode: { type: 'string', enum: ['merge', 'replace'], description: 'merge (default): change only the fields written; replace: each section written replaces that section, missing fields get their defaults' },
                version: { type: 'string', description: 'The version from get_settings' },
                force: { type: 'boolean', description: 'Apply even if the settings changed since get_settings' },
            },
            required: ['settings'],
        },
        readOnly: false,
        run: args => {
            const { project } = getAgentState();
            const version = str(args, 'version', true);
            if (version && version !== scriptVersion(printSettings(project)) && args.force !== true) {
                throw new ToolInputError('设置已过期：工程在 get_settings 之后改过。重新 get_settings 再改，或者传 force: true');
            }
            const mode = str(args, 'mode', true) ?? 'merge';
            if (mode !== 'merge' && mode !== 'replace') throw new ToolInputError('mode 只能是 merge / replace');
            const result = commitSettings(str(args, 'settings')!, project, { merge: mode === 'merge' });
            const warnings = result.diagnostics.filter(item => item.severity === 'warning').map(formatDiagnostic);
            if (!result.ok) return { isError: true, content: [{ type: 'text', text: ['没有应用，设置有错误：', ...result.diagnostics.filter(item => item.severity === 'error').map(formatDiagnostic)].join('\n') }] };
            if (result.changes.length === 0) return text(['没有修改', ...warnings].join('\n'));
            return done('apply_settings', `改了${result.changes.join('、')}`, { changes: result.changes, warnings });
        },
    },
    {
        name: 'list_styles',
        title: '风格目录',
        description: 'Catalog of installed style packs: families, styles (id, family, mood, and where the pack provides them label, description of what the shot looks like, keywords), paragraph transitions, per-shot component slots (with option descriptions) and the typographies of other packs that the styles of this pack can borrow (one list per pack; `stylesWithoutBorrowing` names listed styles that cannot borrow). The full catalog is large: narrow it with `pack`, `family` (id or label), `mood` (quiet / neutral / loud) and `keyword` (case-insensitive, matched against the style kind, label, description and keywords; space-separated terms must all match), and/or pass `brief: true` for only id / label / family / mood / description per style (no component slots or borrowable typographies). `style` ("pack/kind") returns the full detail of one style instead of the list.',
        inputSchema: {
            type: 'object',
            properties: {
                pack: { type: 'string', description: 'Only this pack' },
                family: { type: 'string', description: 'Only styles of this family (family id or label)' },
                mood: { type: 'string', enum: ['quiet', 'neutral', 'loud'], description: 'Only styles of this mood' },
                keyword: { type: 'string', description: 'Only styles whose kind, label, description or keywords contain every space-separated term (case-insensitive)' },
                style: { type: 'string', description: 'A style id "pack/kind": return the detail of this one style (other parameters are ignored)' },
                brief: { type: 'boolean', description: 'Compact list: per style only id, label, family, mood and description' },
            },
        },
        readOnly: true,
        run: args => {
            const styleId = str(args, 'style', true);
            if (styleId) {
                const style = getStyle(styleId);
                const pack = style && findPack(style.pack);
                if (!style || !pack) throw new ToolInputError(`没有风格 ${styleId}（写成 pack/kind，见 list_styles）`);
                return json(describeStyleDetail(pack, style));
            }
            const only = str(args, 'pack', true);
            const mood = str(args, 'mood', true);
            if (mood && !MOODS.includes(mood as Mood)) throw new ToolInputError(`mood 只能是 ${MOODS.join(' / ')}`);
            const filter: StyleFilter = {
                family: str(args, 'family', true)?.toLowerCase(),
                mood: mood as Mood | undefined,
                keyword: str(args, 'keyword', true)?.toLowerCase().split(/[\s,，、]+/).filter(Boolean),
            };
            const filtering = Boolean(filter.family || filter.mood || filter.keyword?.length);
            const brief = args.brief === true;
            const packs = listPacks().filter(pack => !only || pack.id === only);
            if (only && packs.length === 0) throw new ToolInputError(`没有风格包 ${only}`);
            return json(packs
                .map(pack => {
                    const styles = pack.styles.filter(style => styleMatches(pack, style, filter));
                    // 筛选时只列出选中的风格用到的族。
                    const families = filtering ? pack.families.filter(family => styles.some(style => style.family === family.id)) : pack.families;
                    return { pack, styles, families };
                })
                // 筛选时没有命中的包不列（指定了 pack 时照样给出，styles 为空）。
                .filter(({ styles }) => !filtering || only || styles.length > 0)
                .map(({ pack, styles, families }) => (brief ? {
                    id: pack.id,
                    label: pack.label,
                    description: pack.description,
                    families: families.map(family => ({ id: family.id, label: family.label })),
                    styles: styles.map(describeStyleBrief),
                } : {
                    id: pack.id,
                    label: pack.label,
                    description: pack.description,
                    families: families.map(describeFamily),
                    styles: styles.map(describeStyle),
                    transitions: pack.transitions.map(transition => ({ id: transition.id, label: transition.label })),
                    componentSlots: pack.componentSlots?.map(describeSlot) ?? [],
                    ...borrowingOf(pack, styles),
                })), 'packs');
        },
    },
    {
        name: 'render_frame',
        title: '截一帧',
        description: 'Render the preview at `time` seconds and return it as a PNG; or pass `times` (up to 6 seconds values) to get several frames in one call (one image plus a caption each, in order). The user\'s playhead is put back where it was afterwards (playback pauses during the capture and resumes). Use it to check how an edit looks.',
        inputSchema: {
            type: 'object',
            properties: {
                time: { type: 'number', minimum: 0, description: 'Seconds' },
                times: { type: 'array', items: { type: 'number', minimum: 0 }, minItems: 1, maxItems: MAX_FRAMES, description: `Several moments in seconds (at most ${MAX_FRAMES}); used instead of time` },
                maxWidth: { type: 'integer', minimum: 160, maximum: 1920, description: 'Downscale to this width (default 960)' },
            },
        },
        readOnly: true,
        run: async args => {
            const times = frameTimes(args);
            const maxWidth = optNum(args, 'maxWidth', { min: 160, max: 1920 }) ?? 960;
            // 编辑后预览要等 React 把新编排下发给内核。
            await nextFrames(2);
            const kernel = getPreviewKernel();
            if (!kernel) throw new ToolInputError('预览还没有就绪');
            const frames = await withPlayheadRestored(async seek => {
                const captured: Array<{ time: number; data: string; width: number; height: number }> = [];
                for (const time of times) {
                    // seek 让跟着时钟走的背景视频也到这一刻；prepareAt 等视频帧解码好。
                    seek(time);
                    await kernel.prepareAt(time);
                    kernel.renderAt(time);
                    // WebGL 画布要在渲染的同一个任务里读出来。
                    const source = kernel.canvas;
                    const scale = Math.min(1, maxWidth / source.width);
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.round(source.width * scale);
                    canvas.height = Math.round(source.height * scale);
                    canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
                    captured.push({ time, data: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height });
                }
                return captured;
            });
            return {
                content: frames.flatMap(frame => [
                    { type: 'image' as const, data: frame.data, mimeType: 'image/png' },
                    { type: 'text' as const, text: `t = ${round(frame.time)}s，${frame.width}×${frame.height}` },
                ]),
            };
        },
    },
    {
        name: 'get_theme_brief',
        title: '主题配色说明',
        description: 'Instructions and source text (lyrics or title) for generating a light + dark theme, plus the output JSON Schema — the same prompt the built-in AI of lumisynth uses. Generate the object yourself, then call set_theme with it.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: () => text(themeBrief()),
    },
    {
        name: 'set_theme',
        title: '设置主题',
        description: 'Replace the project theme with a light + dark pair (same shape as the `theme` prompt asks for). Colors are sanitized; the result is undoable.',
        inputSchema: THEME_SCHEMA,
        readOnly: false,
        run: args => {
            if (typeof args.light !== 'object' || typeof args.dark !== 'object') throw new ToolInputError('需要 light 与 dark 两套主题');
            const dual = sanitizeThemeResult(args, 'agent');
            updateProject(project => ({ ...project, theme: { ...project.theme, source: 'ai', dual } }));
            return done('set_theme', `主题已设为「${dual[useProjectStore.getState().project.theme.variant].name}」`);
        },
    },
    {
        name: 'set_typography',
        title: '字体',
        description: 'Set lyric and subtitle fonts: families (CSS font-family names installed on the user machine or uploaded to the project, in fallback order), base style sans/serif/mono, weight 100-900 or null for automatic, lyric size scale 0.6-1.6. Subtitles inherit lyric fonts unless inherit is false. Omitted fields stay as they are.',
        inputSchema: {
            type: 'object',
            properties: {
                lyrics: {
                    type: 'object',
                    properties: {
                        style: { type: 'string', enum: ['sans', 'serif', 'mono'] },
                        families: { type: 'array', items: { type: 'string' } },
                        weight: { type: ['integer', 'null'], minimum: 100, maximum: 900 },
                        scale: { type: 'number', minimum: 0.6, maximum: 1.6 },
                    },
                },
                subtitles: {
                    type: 'object',
                    properties: {
                        inherit: { type: 'boolean' },
                        style: { type: 'string', enum: ['sans', 'serif', 'mono'] },
                        families: { type: 'array', items: { type: 'string' } },
                        weight: { type: ['integer', 'null'], minimum: 100, maximum: 900 },
                    },
                },
            },
        },
        readOnly: false,
        run: args => {
            const current = useProjectStore.getState().project.typography;
            const lyrics = (args.lyrics ?? {}) as Record<string, unknown>;
            const subtitles = (args.subtitles ?? {}) as Record<string, unknown>;
            const next = normalizeTypography({
                ...current,
                lyrics: { ...current.lyrics, ...lyrics },
                subtitles: { ...current.subtitles, ...subtitles },
            });
            updateProject(project => ({ ...project, typography: next }));
            return done('set_typography', '字体已更新', { typography: { lyrics: next.lyrics, subtitles: next.subtitles, uploadedFonts: next.fonts.map(font => font.family) } });
        },
    },
    {
        name: 'get_segmentation_brief',
        title: '分词说明',
        description: 'Instructions and lyric lines for semantic word segmentation, plus the output JSON Schema and the line indices the rows map to — the same prompt the built-in AI of lumisynth uses. Segment them yourself, then call set_segmentation. Pass skipManual: true to leave out lines whose segmentation the user already edited by hand.',
        inputSchema: {
            type: 'object',
            properties: { skipManual: { type: 'boolean', description: 'Leave out lines the user segmented by hand (default false).' } },
        },
        readOnly: true,
        run: args => text(segmentationBrief(args.skipManual === true)),
    },
    {
        name: 'set_segmentation',
        title: '写分词',
        description: 'Set the word segmentation of lyric lines. Each `parts` must join back to exactly the line text. Invalid lines are skipped and reported.',
        inputSchema: {
            type: 'object',
            properties: {
                lines: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: { index: { type: 'integer', minimum: 0 }, parts: { type: 'array', items: { type: 'string' } } },
                        required: ['index', 'parts'],
                    },
                },
            },
            required: ['lines'],
        },
        readOnly: false,
        run: args => {
            if (!Array.isArray(args.lines)) throw new ToolInputError('lines 必须是数组');
            const { program } = getAgentState();
            const accepted: Array<{ index: number; hash: string; parts: string[] }> = [];
            const rejected: number[] = [];
            for (const item of args.lines as Array<{ index?: unknown; parts?: unknown }>) {
                const line = typeof item?.index === 'number' ? program.lines[item.index] : undefined;
                const parts = Array.isArray(item?.parts) ? item.parts.map(String) : null;
                if (!line || !parts || !isValidWordSegmentation(line.line.fullText, parts)) {
                    rejected.push(typeof item?.index === 'number' ? item.index : -1);
                    continue;
                }
                accepted.push({ index: line.anchor.index, hash: line.anchor.hash, parts });
            }
            if (accepted.length > 0) {
                updateProject(project => {
                    const replaced = new Set(accepted.map(item => `${item.index}:${item.hash}`));
                    const kept = project.lyricEdits.segments.filter(item => !replaced.has(`${item.anchor.index}:${item.anchor.hash}`));
                    return {
                        ...project,
                        lyricEdits: {
                            ...project.lyricEdits,
                            segments: [...kept, ...accepted.map(item => ({ anchor: { index: item.index, hash: item.hash }, parts: item.parts }))],
                        },
                    };
                });
            }
            return done('set_segmentation', `写入 ${accepted.length} 行分词${rejected.length ? `，跳过 ${rejected.length} 行` : ''}`, { rejectedLines: rejected });
        },
    },
    {
        name: 'set_line_text',
        title: '改歌词',
        description: 'Change the text and/or the translation of one lyric line (give at least one of them). Text: characters that did not change keep their timing; new characters share the time of what they replaced. Everything attached to the line (paragraph direction, locks, clips) stays valid. If the line had a manual segmentation that no longer spells the new text, the result says so and includes the proposed repair (apply it with fix_segmentation). Translation: the subtitle shown under the lyric; an empty string hides it for this line (e.g. a credit such as "translated by …" or a "//" placeholder that the lyric file put into the translation), and writing the translation of the lyric file again drops the edit (reset_lyric_line with what "translation" does the same).',
        inputSchema: {
            type: 'object',
            properties: {
                line: { type: 'integer', minimum: 0, description: 'Lyric line index (from get_lyrics)' },
                text: { type: 'string', description: 'New lyric text' },
                translation: { type: 'string', description: 'New translation (subtitle); "" hides it' },
            },
            required: ['line'],
        },
        readOnly: false,
        run: args => {
            const { project, program, lyrics } = getAgentState();
            const index = num(args, 'line', { min: 0 });
            const item = program.lines[index];
            if (!item) throw new ToolInputError(`没有第 ${index} 行`);
            const text = str(args, 'text', true);
            const translation = args.translation;
            if (text === undefined && translation === undefined) throw new ToolInputError('text 与 translation 至少给一个');
            if (translation !== undefined && typeof translation !== 'string') throw new ToolInputError('translation 必须是字符串（空字符串表示不显示译文）');
            if (text !== undefined && !text.trim()) throw new ToolInputError('歌词不能是空的');
            let next = project;
            const summary: string[] = [];
            if (text !== undefined) {
                next = withLineText(next, item.anchor, item.line, text);
                if (next !== project) summary.push(`第 ${index} 行改为「${text}」`);
            }
            if (translation !== undefined) {
                const original = lyrics.source?.lines[item.anchor.index]?.translation;
                const before = next;
                next = withLineTranslation(next, item.anchor, translation, original);
                const was = item.line.translation ?? '';
                const now = translation.replace(/[\r\n]+/g, ' ').trim();
                if (now !== was.trim()) summary.push(now ? `第 ${index} 行的译文改为「${now}」` : `第 ${index} 行不显示译文`);
                else next = before;
            }
            if (summary.length === 0) throw new ToolInputError('文字与译文都没有变化');
            updateProject(() => next);
            const repair = text !== undefined
                ? segmentationRepairFor(next, item.anchor, { ...item.line, fullText: text.replace(/[\r\n]+/g, ' ') })
                : null;
            return done('set_line_text', summary.join('，'), repair ? { segmentationStale: true, proposedSegmentation: repair } : {});
        },
    },
    {
        name: 'set_line_timing',
        title: '行时间',
        description: 'Set the start and end (seconds, as shown in get_lyrics) of one lyric line. Word timing inside the line is scaled along.',
        inputSchema: {
            type: 'object',
            properties: { line: { type: 'integer', minimum: 0 }, start: { type: 'number', minimum: 0 }, end: { type: 'number', minimum: 0 } },
            required: ['line', 'start', 'end'],
        },
        readOnly: false,
        run: args => {
            const { project, program } = getAgentState();
            const index = num(args, 'line', { min: 0 });
            const item = program.lines[index];
            if (!item) throw new ToolInputError(`没有第 ${index} 行`);
            const start = num(args, 'start', { min: 0 });
            const end = num(args, 'end', { min: 0 });
            if (end <= start) throw new ToolInputError('end 要晚于 start');
            updateProject(() => withLineBounds(project, item.anchor, item.line, { startTime: start, endTime: end }));
            return done('set_line_timing', `第 ${index} 行的时间改为 ${round(start)}–${round(end)}`);
        },
    },
    {
        name: 'set_word_timing',
        title: '逐字时间',
        description: 'Set the word (timing unit) timing of one lyric line: words is [{text, startTime, endTime}] in seconds as shown in get_lyrics; the texts must spell the line (whitespace ignored), e.g. one unit per CJK character. Units are kept in order, non-overlapping, at least 30 ms long and inside the line. Optional start / end also move the line bounds.',
        inputSchema: {
            type: 'object',
            properties: {
                line: { type: 'integer', minimum: 0 },
                words: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, startTime: { type: 'number' }, endTime: { type: 'number' } }, required: ['text', 'startTime', 'endTime'] } },
                start: { type: 'number', minimum: 0 },
                end: { type: 'number', minimum: 0 },
            },
            required: ['line', 'words'],
        },
        readOnly: false,
        run: args => {
            const { project, program } = getAgentState();
            const index = num(args, 'line', { min: 0 });
            const item = program.lines[index];
            if (!item) throw new ToolInputError(`没有第 ${index} 行`);
            if (!Array.isArray(args.words)) throw new ToolInputError('words 必须是数组');
            const words = (args.words as Array<Record<string, unknown>>).map(word => ({ text: String(word.text ?? ''), startTime: Number(word.startTime), endTime: Number(word.endTime) }));
            if (words.some(word => !Number.isFinite(word.startTime) || !Number.isFinite(word.endTime))) throw new ToolInputError('startTime / endTime 必须是数字');
            const start = optNum(args, 'start', { min: 0 }) ?? Math.min(item.line.startTime, words[0]?.startTime ?? item.line.startTime);
            const end = optNum(args, 'end', { min: 0 }) ?? Math.max(item.line.endTime, words.at(-1)?.endTime ?? item.line.endTime);
            const next = withLineWords(project, item.anchor, item.line, words, { startTime: start, endTime: end });
            if (!next) throw new ToolInputError(`这些字拼不回第 ${index} 行的文字「${item.line.fullText}」`);
            updateProject(() => next);
            return done('set_word_timing', `写入第 ${index} 行的逐字时间（${words.length} 个）`);
        },
    },
    {
        name: 'fix_segmentation',
        title: '修复分词',
        description: 'Repair the manual word segmentation of a lyric line after its text was edited: manual cuts outside the edited span are kept, only the edited span is re-segmented automatically.',
        inputSchema: { type: 'object', properties: { line: { type: 'integer', minimum: 0 } }, required: ['line'] },
        readOnly: false,
        run: args => {
            const { project, program } = getAgentState();
            const index = num(args, 'line', { min: 0 });
            const item = program.lines[index];
            if (!item) throw new ToolInputError(`没有第 ${index} 行`);
            const repair = segmentationRepairFor(project, item.anchor, item.line);
            if (!repair) throw new ToolInputError('这一行没有需要修复的手动分词');
            updateProject(() => withRepairedSegmentation(project, item.anchor, item.line));
            return done('fix_segmentation', `第 ${index} 行的分词修复为 ${repair.join('|')}`, { parts: repair });
        },
    },
    {
        name: 'reset_lyric_line',
        title: '恢复歌词行',
        description: 'Undo hand edits of one lyric line: what "text" restores the original text, "translation" the translation of the lyric file, "timing" line and word timing, "all" everything.',
        inputSchema: {
            type: 'object',
            properties: { line: { type: 'integer', minimum: 0 }, what: { type: 'string', enum: ['text', 'translation', 'timing', 'all'] } },
            required: ['line', 'what'],
        },
        readOnly: false,
        run: args => {
            const { project, program } = getAgentState();
            const index = num(args, 'line', { min: 0 });
            const item = program.lines[index];
            if (!item) throw new ToolInputError(`没有第 ${index} 行`);
            const what = str(args, 'what');
            const next = what === 'text' ? withoutLineText(project, item.anchor)
                : what === 'translation' ? withoutLineTranslation(project, item.anchor)
                    : what === 'timing' ? withoutLineTiming(project, item.anchor)
                        : what === 'all' ? withoutLineEdit(project, item.anchor)
                            : null;
            if (!next) throw new ToolInputError('what 只能是 text / translation / timing / all');
            if (next === project) throw new ToolInputError('这一行没有这类修改');
            updateProject(() => next);
            const restored = { text: '原文', translation: '原来的译文', timing: '原始时间', all: '原样' }[what as 'text' | 'translation' | 'timing' | 'all'];
            return done('reset_lyric_line', `第 ${index} 行恢复了${restored}`);
        },
    },
    {
        name: 'get_scene_direction_brief',
        title: '全曲编排说明',
        description: 'Instructions, the style catalog and per-paragraph summaries (kind, lyrics, energy from the audio analysis) for directing the whole song, plus the output JSON Schema — the same prompt the built-in AI of lumisynth uses. Decide the direction yourself, then call apply_scene_direction.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: () => text(sceneDirectionBrief()),
    },
    {
        name: 'apply_scene_direction',
        title: '编排全曲',
        description: 'Apply a whole-song scene direction (same shape as the `scene_direction` prompt asks for): per paragraph (index from 0, as in get_arrangement) a pack, energy 0..1, allowed families and an outgoing transition ("auto", "none" or a transition id). It only sets those four things on the existing paragraphs: it does NOT change how the song is split into paragraphs (use edit_structure or apply_script for that) nor paragraph kinds (set_paragraph_kind), shot styles or components. Replaces earlier AI/agent directions; paragraphs whose direction the user set by hand are left alone, as are transitions the user set. The result has `structureChanged: false`, `skippedManual` (paragraph indices whose direction was kept because the user set it) and `skippedManualTransitions` (paragraphs whose hand-set transition was kept).',
        inputSchema: SCENE_DIRECTION_SCHEMA,
        readOnly: false,
        run: args => {
            const { program, project } = getAgentState();
            const request = buildSceneDirectionRequest(program, project, useSession.getState().analysis);
            const response = sanitizeSceneDirection(args, request);
            if (response.paragraphs.length === 0) throw new ToolInputError('没有一条可用的段落编排（检查 pack / 段落序号）');
            // 与 applySceneDirection 的判断一致：用户手动设过的段落编排、手动设过的转场不会被盖掉。
            const anchorKey = (paragraph: LumiParagraph) => `${paragraph.anchor.line.index}:${paragraph.anchor.line.hash}`;
            const userDirections = new Set(project.paragraphDirections.filter(item => item.source === 'user').map(item => `${item.anchor.line.index}:${item.anchor.line.hash}`));
            const userTransitions = new Set(project.overrides
                .filter(op => op.type === 'transition' && !op.id.startsWith('ai-'))
                .map(op => `${op.anchor.line.index}:${op.anchor.line.hash}`));
            const targets = response.paragraphs.flatMap(item => {
                const paragraph = program.paragraphs[item.index];
                return paragraph ? [{ item, paragraph }] : [];
            });
            const skippedManual = targets.filter(({ paragraph }) => userDirections.has(anchorKey(paragraph))).map(({ item }) => item.index);
            const skippedManualTransitions = targets
                .filter(({ item, paragraph }) => item.transition !== 'auto' && userTransitions.has(anchorKey(paragraph)))
                .map(({ item }) => item.index);
            applySceneDirection(program, response);
            return done('apply_scene_direction', `编排了 ${response.paragraphs.length} 段${skippedManual.length ? `（跳过手动设置的 ${skippedManual.length} 段）` : ''}`, {
                structureChanged: false,
                skippedManual,
                skippedManualTransitions,
                ...invalidAfterWrite(),
            });
        },
    },
    {
        name: 'set_paragraph_direction',
        title: '段落编排',
        description: 'Override one paragraph: which pack draws it, energy 0..1 and allowed style families. Pass "auto" to hand a field back to the automatic rules.',
        inputSchema: {
            type: 'object',
            properties: {
                paragraph: PARAGRAPH,
                pack: { type: 'string', description: 'Pack id or "auto"' },
                energy: { description: 'Number 0..1, null (pack decides) or "auto"' },
                families: { description: 'Array of family ids, null (all) or "auto"' },
            },
            required: ['paragraph'],
        },
        readOnly: false,
        run: args => {
            const { program } = getAgentState();
            const paragraph = paragraphAt(program, num(args, 'paragraph', { min: 0 }));
            const patch: DirectionPatch = {};
            if (args.pack !== undefined) {
                const pack = str(args, 'pack')!;
                if (pack !== 'auto' && !findPack(pack)) throw new ToolInputError(`没有风格包 ${pack}`);
                patch.pack = pack;
            }
            if (args.energy !== undefined) {
                if (args.energy === 'auto' || args.energy === null) patch.energy = args.energy as 'auto' | null;
                else patch.energy = num(args, 'energy', { min: 0, max: 1 });
            }
            if (args.families !== undefined) {
                if (args.families === 'auto' || args.families === null) patch.families = args.families as 'auto' | null;
                else if (Array.isArray(args.families)) patch.families = args.families.map(String);
                else throw new ToolInputError('families 必须是数组、null 或 "auto"');
            }
            updateProject(project => patchParagraphDirection(project, paragraph.anchor, patch));
            return done('set_paragraph_direction', `第 ${paragraph.index} 段：${JSON.stringify(patch)}`, invalidAfterWrite());
        },
    },
    {
        name: 'edit_structure',
        title: '分段',
        description: 'Change how the song is split into paragraphs. action "split": start a new paragraph at lyric line `line` (the new paragraph copies the direction of the one it came from). "merge": merge `paragraph` into the previous one (its own direction is dropped). "move_start": move the start of `paragraph` to lyric line `line` (must be after the first line of the previous paragraph and within this paragraph); its settings move along. "reset": remove manual splits / merges inside `paragraph`. Undoable; the result lists what changed.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['split', 'merge', 'move_start', 'reset'] },
                paragraph: PARAGRAPH,
                line: { type: 'integer', minimum: 0, description: 'Lyric line index (from get_lyrics)' },
            },
            required: ['action'],
        },
        readOnly: false,
        run: args => {
            const { program } = getAgentState();
            const action = str(args, 'action');
            const notes: string[] = [];
            const collect = (message: string) => notes.push(message);
            let changed = false;
            if (action === 'split') {
                const line = num(args, 'line', { min: 0 });
                if (!program.lines[line]) throw new ToolInputError(`没有第 ${line} 行`);
                changed = splitParagraphAt(program, line, collect);
            } else {
                const paragraph = paragraphAt(program, num(args, 'paragraph', { min: 0 }));
                if (action === 'merge') changed = mergeWithPrevious(program, paragraph, collect);
                else if (action === 'move_start') changed = moveParagraphStart(program, paragraph, num(args, 'line', { min: 0 }), collect);
                else if (action === 'reset') changed = resetParagraphStructure(program, paragraph, collect);
                else throw new ToolInputError(`不认识的 action：${action}`);
            }
            if (!changed) throw new ToolInputError('没有变化（这一行已经是段首、已经是第一段，或者位置超出了允许范围）');
            const after = getAgentState().program;
            return done('edit_structure', notes.join('；'), { paragraphs: after.paragraphs.map(paragraph => ({ index: paragraph.index, lines: paragraph.lineIndices, kind: paragraph.kind })) });
        },
    },
    {
        name: 'set_paragraph_kind',
        title: '段落性质',
        description: 'Override the kind of a paragraph (verse, lift, chorus, breath, break, outro) or "auto". The kind picks the pack in mix mode and the energy of shots.',
        inputSchema: { type: 'object', properties: { paragraph: PARAGRAPH, kind: { type: 'string', enum: ['auto', 'verse', 'lift', 'chorus', 'breath', 'break', 'outro'] } }, required: ['paragraph', 'kind'] },
        readOnly: false,
        run: args => {
            const { program } = getAgentState();
            const paragraph = paragraphAt(program, num(args, 'paragraph', { min: 0 }));
            const kind = str(args, 'kind');
            if (kind !== 'auto' && !PARAGRAPH_KINDS.includes(kind as never)) throw new ToolInputError(`没有这种性质：${kind}`);
            setParagraphKind(paragraph, kind as never);
            return done('set_paragraph_kind', `第 ${paragraph.index} 段的性质：${kind}`);
        },
    },
    {
        name: 'set_paragraph_transition',
        title: '段落转场',
        description: 'Set the transition out of a paragraph: a transition id from list_styles, "none", or "auto".',
        inputSchema: { type: 'object', properties: { paragraph: PARAGRAPH, transition: { type: 'string' } }, required: ['paragraph', 'transition'] },
        readOnly: false,
        run: args => {
            const { program } = getAgentState();
            const paragraph = paragraphAt(program, num(args, 'paragraph', { min: 0 }));
            const transition = str(args, 'transition')!;
            if (transition !== 'auto' && transition !== 'none' && !getTransition(transition)) throw new ToolInputError(`没有转场 ${transition}`);
            setParagraphTransition(paragraph, transition);
            return done('set_paragraph_transition', `第 ${paragraph.index} 段的出场转场：${transition}`);
        },
    },
    {
        name: 'set_shot_style',
        title: '镜头风格',
        description: 'Lock one shot to a style id (from list_styles), or "auto" to unlock. A style from another pack only takes effect when direction.shotMixing is on; switching to another pack also drops the component overrides of this shot that the new pack does not have.',
        inputSchema: { type: 'object', properties: { paragraph: PARAGRAPH, shot: SHOT, style: { type: 'string' } }, required: ['paragraph', 'shot', 'style'] },
        readOnly: false,
        run: args => {
            const { program } = getAgentState();
            const shot = shotAt(program, num(args, 'paragraph', { min: 0 }), num(args, 'shot', { min: 0 }));
            const style = str(args, 'style')!;
            if (style === 'auto') unlockShotStyle(shot);
            else {
                if (!getStyle(style)) throw new ToolInputError(`没有风格 ${style}`);
                lockShotStyle(shot, style);
            }
            return done('set_shot_style', `镜头 ${args.paragraph}.${args.shot} → ${style}`, invalidAfterWrite());
        },
    },
    {
        name: 'set_shot_component',
        title: '镜头组件',
        description: 'Replace one component (e.g. "typography", "accent") of a shot. Values come from list_styles componentSlots, or for typography "<pack>/<typography>" to borrow another pack\'s typography. "auto" removes the override.',
        inputSchema: {
            type: 'object',
            properties: { paragraph: PARAGRAPH, shot: SHOT, slot: { type: 'string' }, value: { type: 'string' } },
            required: ['paragraph', 'shot', 'slot', 'value'],
        },
        readOnly: false,
        run: args => {
            const { program } = getAgentState();
            const shot = shotAt(program, num(args, 'paragraph', { min: 0 }), num(args, 'shot', { min: 0 }));
            const slot = str(args, 'slot')!;
            const value = str(args, 'value')!;
            setShotComponent(shot, slot, value);
            const after = getAgentState().program.invalidOps.filter(item => item.op.type === 'shot-component');
            if (value !== 'auto' && after.some(item => item.op.type === 'shot-component' && item.op.slot === slot && item.op.value === value)) {
                useProjectStore.getState().undo();
                throw new ToolInputError(`这个镜头的 ${slot} 不接受 ${value}（已撤销）`);
            }
            return done('set_shot_component', `镜头 ${args.paragraph}.${args.shot} 的 ${slot} → ${value}`);
        },
    },
    {
        name: 'list_assets',
        title: '素材库',
        description: 'Images and videos in the project asset library, background clips, and the asset clips placed on screen (id, asset, timing, resolved start/end, slot, position, scale, rotation, opacity, animations).',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: () => {
            const { project, program } = getAgentState();
            const { resolved, invalid } = resolveAssetClips(project.assetClips, program, new Set(project.assets.map(item => item.id)));
            return json({
                assets: project.assets.map(item => ({ id: item.id, name: item.name, kind: item.kind, width: item.width, height: item.height, temperaAuto: isInTemperaPool(project, item.id) })),
                clips: resolved.map(clip => ({ ...clip, start: round(clip.start), end: round(clip.end) })),
                invalidClips: invalid.map(item => ({ id: item.clip.id, reason: item.reason })),
                backgrounds: resolveBackgroundClips(project.backgroundClips, program, new Set(project.assets.map(item => item.id))).resolved
                    .map(clip => ({ ...clip, start: round(clip.start), end: clip.timing.type === 'song' ? 'song-end' : round(clip.end) })),
            });
        },
    },
    {
        name: 'place_asset',
        title: '摆放素材',
        description: 'Put a library image on screen. Timing follows a shot ({paragraph, shot}), a paragraph ({paragraph}), or absolute seconds ({start, end}). slot: back (under the scene) | front (over the scene) | overlay (top). x/y are the center (0..1 of the frame), scale is the height as a fraction of the frame height. Returns the clip id.',
        inputSchema: {
            type: 'object',
            properties: {
                asset: { type: 'string', description: 'Asset id from list_assets' },
                paragraph: PARAGRAPH,
                shot: SHOT,
                start: { type: 'number', minimum: 0 },
                end: { type: 'number', minimum: 0 },
                slot: { type: 'string', enum: ['back', 'mid', 'front', 'overlay'], description: 'back: under the scene; mid: above the scene graphics but under the lyrics; front: above the lyrics; overlay: on top of everything' },
                x: { type: 'number' },
                y: { type: 'number' },
                scale: { type: 'number', minimum: 0.02, maximum: 3 },
                rotation: { type: 'number', description: 'Radians' },
                opacity: { type: 'number', minimum: 0, maximum: 1 },
                follow: { type: 'string', enum: ['off', 'scene', 'motion'], description: 'Follow the camera: scene = stick to the scene (jumps at shot cuts), motion = only the in-shot camera motion (restarts at each shot)' },
                followAmount: { type: 'number', minimum: 0, maximum: 1, description: 'How much of the camera motion to follow (default 1)' },
            },
            required: ['asset'],
        },
        readOnly: false,
        run: args => {
            const { project, program } = getAgentState();
            const assetId = str(args, 'asset')!;
            if (!project.assets.some(item => item.id === assetId)) throw new ToolInputError(`素材库里没有 ${assetId}`);
            let timing: ClipTiming;
            if (args.start !== undefined) {
                const start = num(args, 'start', { min: 0 });
                timing = { type: 'absolute', start, end: Math.max(start + 0.1, optNum(args, 'end', { min: 0 }) ?? start + 4) };
            } else if (args.shot !== undefined) {
                timing = { type: 'shot', anchor: shotAt(program, num(args, 'paragraph', { min: 0 }), num(args, 'shot', { min: 0 })).anchor };
            } else if (args.paragraph !== undefined) {
                timing = { type: 'paragraph', anchor: paragraphAt(program, num(args, 'paragraph', { min: 0 })).anchor };
            } else {
                throw new ToolInputError('需要 start / end，或 paragraph（+ shot）');
            }
            const clip = addAssetClip(assetId, timing, clipPatch(args));
            return done('place_asset', `已摆放素材片段 ${clip.id}`, { clip: clip.id });
        },
    },
    {
        name: 'update_asset_clip',
        title: '调整素材片段',
        description: 'Change an asset clip: slot, x, y, scale, rotation, opacity, flipX, blend (normal|add|multiply|screen), enter/exit ({type: none|fade|slide-up|slide-down|slide-left|slide-right|zoom|rush-left|rush-right|pop, duration}; rush-* comes in fast from off-frame with an overshoot, pop springs up from small), lead/tail seconds, follow (off|scene|motion) and followAmount (0..1) to make it move with the camera; x, y, scale and rotation are the values without camera motion. Pass remove: true to delete it.',
        inputSchema: {
            type: 'object',
            properties: {
                clip: { type: 'string' },
                remove: { type: 'boolean' },
                slot: { type: 'string', enum: ['back', 'mid', 'front', 'overlay'], description: 'back: under the scene; mid: above the scene graphics but under the lyrics; front: above the lyrics; overlay: on top of everything' },
                x: { type: 'number' }, y: { type: 'number' }, scale: { type: 'number' }, rotation: { type: 'number' },
                opacity: { type: 'number' }, flipX: { type: 'boolean' },
                blend: { type: 'string', enum: ['normal', 'add', 'multiply', 'screen'] },
                enter: { type: 'object' }, exit: { type: 'object' },
                lead: { type: 'number' }, tail: { type: 'number' },
                follow: { type: 'string', enum: ['off', 'scene', 'motion'], description: 'Follow the camera: scene = stick to the scene (jumps at shot cuts), motion = only the in-shot camera motion (restarts at each shot)' },
                followAmount: { type: 'number', minimum: 0, maximum: 1, description: 'How much of the camera motion to follow (default 1)' },
            },
            required: ['clip'],
        },
        readOnly: false,
        run: args => {
            const id = str(args, 'clip')!;
            if (!useProjectStore.getState().project.assetClips.some(clip => clip.id === id)) throw new ToolInputError(`没有素材片段 ${id}`);
            if (args.remove === true) {
                removeAssetClip(id);
                return done('update_asset_clip', `删除了素材片段 ${id}`);
            }
            updateAssetClip(id, clipPatch(args));
            return done('update_asset_clip', `调整了素材片段 ${id}`);
        },
    },
    {
        name: 'set_background',
        title: '背景',
        description: 'Manage the background track (clips drawn over the default theme / cover background; later clips cover earlier ones). action "add" needs source: {type: theme} | {type: gradient, from, to, angle} | {type: cover} | {type: image, assetId} | {type: video, assetId, offset?, loop?} (videos only work here) and timing: "song", {paragraph} or {start, end}. action "update" takes clip plus any of source/timing/fit (cover|contain)/kenBurns/blur/dim/fadeIn/fadeOut. action "remove" takes clip. list_backgrounds is part of list_assets.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['add', 'update', 'remove'] },
                clip: { type: 'string' },
                source: { type: 'object' },
                timing: { description: '"song", {paragraph}, or {start, end}' },
                fit: { type: 'string', enum: ['cover', 'contain'] },
                kenBurns: { type: 'number' }, blur: { type: 'number' }, dim: { type: 'number' },
                fadeIn: { type: 'number' }, fadeOut: { type: 'number' },
            },
            required: ['action'],
        },
        readOnly: false,
        run: args => {
            const { project, program } = getAgentState();
            const action = str(args, 'action');
            const assetIds = new Set(project.assets.map(item => item.id));
            const readSource = (value: unknown): BackgroundSource => {
                const raw = (value ?? {}) as Record<string, unknown>;
                if (raw.type === 'theme' || raw.type === 'cover') return { type: raw.type };
                if (raw.type === 'gradient') return { type: 'gradient', from: String(raw.from ?? '#1e1b4b'), to: String(raw.to ?? '#0f766e'), angle: Number(raw.angle ?? 20) };
                const assetId = String(raw.assetId ?? '');
                const asset = project.assets.find(item => item.id === assetId);
                if (!asset || !assetIds.has(assetId)) throw new ToolInputError(`素材库里没有 ${assetId}`);
                if (raw.type === 'image' && asset.kind === 'image') return { type: 'image', assetId };
                if (raw.type === 'video' && asset.kind === 'video') return { type: 'video', assetId, offset: Math.max(0, Number(raw.offset ?? 0)), loop: raw.loop !== false };
                throw new ToolInputError('source.type 与素材类型不符（image / video）');
            };
            const readTiming = (value: unknown): ClipTiming => {
                if (value === 'song' || value === undefined) return { type: 'song' };
                const raw = value as Record<string, unknown>;
                if (typeof raw.start === 'number') return { type: 'absolute', start: raw.start, end: Math.max(raw.start + 0.1, Number(raw.end ?? raw.start + 10)) };
                if (typeof raw.paragraph === 'number') return { type: 'paragraph', anchor: paragraphAt(program, raw.paragraph).anchor };
                throw new ToolInputError('timing 需要 "song"、{paragraph} 或 {start, end}');
            };
            const look = (): Partial<BackgroundClip> => {
                const patch: Partial<BackgroundClip> = {};
                if (args.fit === 'cover' || args.fit === 'contain') patch.fit = args.fit;
                for (const key of ['kenBurns', 'blur', 'dim', 'fadeIn', 'fadeOut'] as const) {
                    if (typeof args[key] === 'number' && Number.isFinite(args[key])) patch[key] = Math.max(0, args[key] as number);
                }
                return patch;
            };
            if (action === 'add') {
                const clip = addBackgroundClip(readSource(args.source), readTiming(args.timing), look());
                return done('set_background', `添加了背景片段 ${clip.id}`, { clip: clip.id });
            }
            const id = str(args, 'clip')!;
            if (!project.backgroundClips.some(clip => clip.id === id)) throw new ToolInputError(`没有背景片段 ${id}`);
            if (action === 'remove') {
                removeBackgroundClip(id);
                return done('set_background', `删除了背景片段 ${id}`);
            }
            if (action !== 'update') throw new ToolInputError(`不认识的 action：${action}`);
            updateBackgroundClip(id, {
                ...look(),
                ...(args.source !== undefined ? { source: readSource(args.source) } : {}),
                ...(args.timing !== undefined ? { timing: readTiming(args.timing) } : {}),
            });
            return done('set_background', `调整了背景片段 ${id}`);
        },
    },
    {
        name: 'undo',
        title: '撤销',
        description: 'Undo the last edit(s) in the project (user and agent edits share one history).',
        inputSchema: { type: 'object', properties: { steps: { type: 'integer', minimum: 1, maximum: 50 } } },
        readOnly: false,
        run: args => {
            const steps = optNum(args, 'steps', { min: 1, max: 50 }) ?? 1;
            for (let i = 0; i < steps; i += 1) useProjectStore.getState().undo();
            return done('undo', `撤销 ${steps} 步`);
        },
    },
    {
        name: 'export_video',
        title: '导出视频',
        description: 'Render the project to a video file in the browser and download it (the browser saves it to the user\'s download folder; no file path is known to the page). Takes about as long as rendering every frame; returns when finished with a summary line and structured file info: fileName, bytes, width, height, fps, start, end, duration (seconds), hasAudio, format (file extension), mimeType, videoCodec, audioCodec.',
        inputSchema: {
            type: 'object',
            properties: {
                shortSide: { type: 'integer', enum: [720, 1080, 1440, 2160], description: 'Default 1080' },
                fps: { type: 'integer', enum: [24, 30, 60], description: 'Default 30' },
                format: { type: 'string', enum: ['mp4', 'webm'], description: 'Default mp4' },
                start: { type: 'number', minimum: 0, description: 'Seconds (default 0)' },
                end: { type: 'number', minimum: 0, description: 'Seconds (default: end of song)' },
            },
        },
        readOnly: false,
        run: async args => {
            const { project, program } = getAgentState();
            const session = useSession.getState();
            const duration = session.audioBuffer?.duration ?? program.paragraphs.at(-1)?.endTime ?? 0;
            if (duration <= 0) throw new ToolInputError('工程是空的：先导入音频或歌词');
            const shortSide = optNum(args, 'shortSide') ?? 1080;
            const fps = optNum(args, 'fps', { min: 1, max: 60 }) ?? 30;
            const format = (str(args, 'format', true) ?? 'mp4') as ExportFormat;
            const start = Math.min(duration, optNum(args, 'start', { min: 0 }) ?? 0);
            const end = Math.min(duration, Math.max(start + 0.5, optNum(args, 'end', { min: 0 }) ?? duration));
            const { width, height } = exportSizeFor(project, shortSide);
            try {
                const output = await exportVideo(buildProjectExportInput(project, program, session), {
                    width, height, fps, format, quality: 'high', start, end,
                }, () => undefined);
                const { downloadBlob } = await import('@/app/download');
                const name = exportFileName(project, output.extension);
                downloadBlob(output.blob, name);
                const summary = `已导出并下载 ${name}（${width}×${height} ${fps}fps，${(output.blob.size / 1e6).toFixed(1)} MB）`;
                listeners.forEach(listener => listener({ tool: 'export_video', ok: true, summary }));
                const file = {
                    fileName: name,
                    bytes: output.blob.size,
                    width,
                    height,
                    fps,
                    start: round(start),
                    end: round(end),
                    duration: round(end - start),
                    hasAudio: output.audioCodec !== null,
                    format: output.extension,
                    mimeType: output.mimeType,
                    videoCodec: output.videoCodec,
                    audioCodec: output.audioCodec,
                };
                // 第一段文字是原来的摘要；第二段与 structuredContent 是结构化的文件信息。
                return { content: [{ type: 'text', text: summary }, { type: 'text', text: JSON.stringify(file, null, 2) }], structuredContent: file };
            } catch (error) {
                if (error instanceof ExportCancelled) throw new ToolInputError('导出被取消');
                throw error;
            }
        },
    },
];

// ---------------------------------------------------------------------------------------------
// 提示词：MCP 的 prompt 版本（由用户在 agent 里触发）。模型自己能调用的是上面的 get_*_brief 工具，内容相同。

export const AGENT_PROMPTS: AgentPrompt[] = [
    {
        name: 'theme',
        title: '生成主题配色',
        description: 'Instructions and source text for generating a light + dark theme; answer by calling set_theme.',
        build: () => ({ description: 'lumisynth 主题配色', text: themeBrief() }),
    },
    {
        name: 'segmentation',
        title: '歌词分词',
        description: 'Instructions and lyric lines for word segmentation; answer by calling set_segmentation.',
        build: () => ({ description: 'lumisynth 分词', text: segmentationBrief(false) }),
    },
    {
        name: 'scene_direction',
        title: '全曲镜头编排',
        description: 'Instructions, style catalog and paragraph summaries for directing the whole song; answer by calling apply_scene_direction.',
        build: () => ({ description: 'lumisynth 镜头编排', text: sceneDirectionBrief() }),
    },
];

export type AgentTask = 'theme' | 'segmentation' | 'scene_direction';

/**
 * 「AI」面板连上 agent 后「复制指令」复制的话：用户粘贴给 agent，它先用 get_*_brief 取到与内置 AI 相同的提示词，
 * 生成后用对应的工具写回。
 */
export const agentTaskInstruction = (task: AgentTask, options: { skipManual?: boolean } = {}) => {
    if (task === 'theme') {
        return '调用 lumisynth 的 get_theme_brief 工具拿到主题配色的生成说明，按说明生成一套深色 + 浅色主题，再调用 set_theme 写回。';
    }
    if (task === 'segmentation') {
        return `调用 lumisynth 的 get_segmentation_brief 工具${options.skipManual ? '（skipManual: true，跳过我手动改过分词的行）' : ''}拿到分词说明和歌词行，按说明分词，再调用 set_segmentation 写回，并告诉我有没有被跳过的行。`;
    }
    return '调用 lumisynth 的 get_scene_direction_brief 工具拿到全曲镜头编排的说明、风格目录与段落摘要，按说明编排，再调用 apply_scene_direction 写回；写完用 render_frame 看几帧，确认效果后告诉我每段选了什么。';
};

// ---------------------------------------------------------------------------------------------
// 调度

const nextFrames = (count: number) => new Promise<void>(resolve => {
    if (typeof requestAnimationFrame !== 'function') {
        setTimeout(resolve, 0);
        return;
    }
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(count);
});

export const findAgentTool = (name: string) => AGENT_TOOLS.find(tool => tool.name === name);

/** 执行一个工具；参数错误与运行错误都变成 isError 的结果（MCP 的约定），不抛出。 */
export const callAgentTool = async (name: string, args: unknown): Promise<ToolResult> => {
    const tool = findAgentTool(name);
    if (!tool) return { content: [{ type: 'text', text: `没有工具 ${name}` }], isError: true };
    try {
        return await tool.run((args && typeof args === 'object' ? args : {}) as Record<string, unknown>);
    } catch (error) {
        const message = (error as Error).message || String(error);
        listeners.forEach(listener => listener({ tool: name, ok: false, summary: message }));
        return { content: [{ type: 'text', text: message }], isError: true };
    }
};

export const getAgentPrompt = (name: string) => {
    const prompt = AGENT_PROMPTS.find(item => item.name === name);
    if (!prompt) throw new ToolInputError(`没有提示词 ${name}`);
    const built = prompt.build();
    return { description: built.description, messages: [{ role: 'user' as const, content: { type: 'text' as const, text: built.text } }] };
};
