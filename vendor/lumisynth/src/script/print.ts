// src/script/print.ts
// 工程 + 编排结果 → 剧本（LumiScript v2）。
// 编排的结果全部写成可以直接改的指令：自动选出的包、energy、族、转场、段落性质、镜头的风格与组件照常写出来，
// 改了值就固定下来；手动固定的值标 locked（AI 编排的标 @ai），去掉标记就交回自动。
// 改不了的编译结果（段落编号与时间、镜头时间、分段原因、余韵）写在「# 」注释里。
// 生成的剧本原样应用回去什么都不会变；手写、复制到别的工程时，和当前自动结果一样的值不会被固定。
// 每行带上它对应的段落 / 镜头 / 片段 / 歌词行，编辑器里点一行就能选中。语法见 docs/SCRIPT.md。
import type { AssetClip, ClipTiming } from '@/core/assets/clips';
import { DEFAULT_CLIP_EFFECT, DEFAULT_CLIP_MOTION, resolveClipRange } from '@/core/assets/clips';
import type { BackgroundClip, BackgroundSource } from '@/core/assets/background';
import { DEFAULT_MIX_BY_KIND, mixAssignment, PARAGRAPH_KINDS, type LumiParagraph, type LumiProgram, type LumiShot, type ParagraphKind } from '@/compiler/types';
import type { LineAnchor } from '@/core/lyrics/edits';
import type { Line } from '@/core/types';
import type { LumiProject } from '@/project/types';
import { SCRIPT_VERSION } from './parse';
import { formatRange, formatTime, num, quote, shortId } from './syntax';

export interface ScriptLine {
    text: string;
    /** 歌词行语句对应的行号（0 起）。 */
    lineIndex?: number;
    paragraphId?: string;
    shotId?: string;
    clipId?: string;
    backgroundId?: string;
}

export interface ProgramScript {
    lines: ScriptLine[];
    text: string;
}

export const KIND_LABELS: Record<ParagraphKind, string> = {
    breath: '换气', verse: '主歌', lift: '上扬', chorus: '副歌', break: '间奏', outro: '尾声',
};

const BOUNDARY_LABELS: Record<string, string> = {
    'song-start': '歌曲开始',
    'time-gap': '停顿超过阈值',
    'lyric-gap': '歌词与无词占位行之间的停顿',
    metadata: '歌词文件的段落标记',
    'duration-cap': '超过最长时长后切开',
    'line-cap': '超过最多行数后切开',
    manual: '手动分段',
};

const sameLine = (a: LineAnchor, b: LineAnchor) => a.index === b.index && a.hash === b.hash;

/** 片段挂载点的写法（段落 / 镜头编号从 1 起，行号从 1 起）；锚点失效时是 missing。 */
export const formatTiming = (timing: ClipTiming, program: LumiProgram): string => {
    if (timing.type === 'song') return 'song';
    if (timing.type === 'absolute') return formatRange(timing.start, timing.end);
    if (timing.type === 'lines') {
        const from = program.lines[timing.from.index];
        const to = program.lines[timing.to.index];
        if (!from || !to || !sameLine(from.anchor, timing.from) || !sameLine(to.anchor, timing.to)) return 'missing';
        return `lines ${timing.from.index + 1}..${timing.to.index + 1}`;
    }
    if (timing.type === 'paragraph') {
        const paragraph = program.paragraphs.find(item => sameLine(item.anchor.line, timing.anchor.line));
        return paragraph ? `paragraph ${paragraph.index + 1}` : 'missing';
    }
    for (const paragraph of program.paragraphs) {
        const index = paragraph.shots.findIndex(item => sameLine(item.anchor.line, timing.anchor.line) && item.anchor.slot === timing.anchor.slot);
        if (index >= 0) return `shot ${paragraph.index + 1}.${index + 1}`;
    }
    return 'missing';
};

export const formatSource = (source: BackgroundSource) => {
    switch (source.type) {
        case 'theme': return 'theme';
        case 'cover': return 'cover';
        case 'gradient': return `gradient ${source.from} ${source.to} ${Math.round(source.angle)}`;
        case 'image': return `image ${shortId(source.assetId)}`;
        case 'video': return `video ${shortId(source.assetId)} offset ${num(source.offset)}${source.loop ? ' loop' : ''}`;
    }
};

/** 注释：把几段说明用「 · 」连起来。 */
const note = (parts: Array<string | null | undefined | false>) => {
    const text = parts.filter(Boolean).join(' · ');
    return text ? `  # ${text}` : '';
};

// ---------------------------------------------------------------------------------------------
// 段落

const shotLines = (program: LumiProgram, paragraph: LumiParagraph, shot: LumiShot, index: number): ScriptLine[] => {
    const ref = { paragraphId: paragraph.id, shotId: shot.id };
    const components = Object.entries(shot.components);
    const texts = shot.isBridge ? [] : shot.lineIndices.map(lineIndex => program.lines[lineIndex]?.line.fullText).filter((text): text is string => Boolean(text));
    const comment = note([
        formatRange(shot.startTime, shot.endTime),
        shot.locked ? null : '自动',
        shot.pack !== paragraph.direction.pack ? `由 ${shot.pack} 来画` : null,
        shot.isBridge ? '间奏，没有歌词' : null,
        shot.borrowedText ? `字由 ${shot.borrowedText.pack} 排` : null,
        texts.length ? texts.map(quote).join(' ') : null,
        !shot.isBridge && shot.lyricEndTime < shot.endTime - 0.05 ? `${formatTime(shot.lyricEndTime)} 起余韵` : null,
    ]);
    const head = `  shot ${index + 1} ${shot.style}${shot.locked ? ' locked' : ''}`;
    if (components.length === 0) return [{ text: `${head}${comment}`, ...ref }];
    return [
        { text: `${head} {${comment}`, ...ref },
        ...components.map(([slot, value]) => ({ text: `    ${slot} ${value}${shot.lockedComponents.includes(slot) ? ' locked' : ''}`, ...ref })),
        { text: '  }', ...ref },
    ];
};

/** 歌词行：line 行号 时间 "文字"，时间是歌词文件的时间（不含 lyric-offset）。译文、逐字时间、分词只在手动改过时写出来。 */
const lyricLines = (program: LumiProgram, paragraph: LumiParagraph, project: LumiProject, sourceLines: Line[] | null): ScriptLine[] => {
    if (!sourceLines) return [];
    const offset = project.lyricEdits.offset;
    return paragraph.lineIndices.flatMap(index => {
        const item = program.lines[index];
        const same = (anchor: LineAnchor) => sameLine(anchor, item.anchor);
        const edit = project.lyricEdits.lines.find(entry => same(entry.anchor));
        const segments = project.lyricEdits.segments.find(entry => same(entry.anchor));
        const stale = segments && segments.parts.join('') !== item.line.fullText;
        const source = sourceLines[index];
        const ref = { paragraphId: paragraph.id, lineIndex: index };
        const comment = note([
            edit?.text !== undefined && source ? `改过字，原文 ${quote(source.fullText)}` : null,
            edit?.translation !== undefined && source ? (source.translation?.trim() ? `改过译文，原来 ${quote(source.translation.trim())}` : '译文是加上的') : null,
            edit && (edit.startTime !== undefined || edit.endTime !== undefined) && source ? `时间改过，原来 ${formatRange(source.startTime, source.endTime)}` : null,
            stale ? `手动分词已失效：${segments.parts.map(quote).join(' ')}` : null,
        ]);
        const head = `  line ${index + 1} ${formatRange(item.line.startTime - offset, item.line.endTime - offset)} ${quote(item.line.fullText)}`;
        const words = edit?.words ? item.line.words : null;
        const parts = segments && !stale ? segments.parts : null;
        const translation = edit?.translation;
        if (!words && !parts && translation === undefined) return [{ text: `${head}${comment}`, ...ref }];
        return [
            { text: `${head} {${comment}`, ...ref },
            ...(translation !== undefined ? [{ text: `    translation ${translation ? quote(translation) : 'none'}`, ...ref }] : []),
            ...(parts ? [{ text: `    parts ${parts.map(quote).join(' ')}`, ...ref }] : []),
            ...(words ?? []).map(word => ({ text: `    word ${formatRange(word.startTime - offset, word.endTime - offset)} ${quote(word.text)}`, ...ref })),
            { text: '  }', ...ref },
        ];
    });
};

const paragraphLines = (program: LumiProgram, paragraph: LumiParagraph, project: LumiProject, sourceLines: Line[] | null): ScriptLine[] => {
    const ref = { paragraphId: paragraph.id };
    const { direction } = paragraph;
    const override = project.paragraphDirections.find(item => sameLine(item.anchor.line, paragraph.anchor.line)
        && !program.invalidDirections.includes(item));
    // 固定下来的值后面标 locked（AI 编排的标 @ai）；没标的是自动选出的，改了值就固定下来。
    const mark = (pinned: boolean) => (!pinned ? '  # 自动' : override?.source === 'ai' ? ' @ai' : ' locked');
    const first = paragraph.lineIndices[0];
    const last = paragraph.lineIndices.at(-1);
    const header = note([
        `第 ${paragraph.index + 1} 段`,
        `${KIND_LABELS[paragraph.kind] ?? paragraph.kind}${paragraph.kindManual ? '' : '（自动）'}`,
        formatRange(paragraph.startTime, paragraph.endTime),
        `${paragraph.shots.length} 个镜头`,
        `分段：${BOUNDARY_LABELS[paragraph.boundary] ?? paragraph.boundary}${paragraph.merged ? '，含手动合并' : ''}`,
    ]);
    const lines: ScriptLine[] = [{ text: `paragraph ${paragraph.kind}${paragraph.kindManual ? ' locked' : ''} {${header}`, ...ref }];
    // 纯音乐（没有歌词文件）没有 line 语句，用 lines 写范围。
    if (!sourceLines && first !== undefined) lines.push({ text: `  lines ${first + 1}..${last! + 1}`, ...ref });
    lines.push({ text: `  pack ${direction.pack}${mark(override?.pack !== undefined)}`, ...ref });
    const energyPinned = override?.energy !== undefined && override.energy !== null;
    lines.push({ text: `  energy ${direction.energy === null ? 'auto' : num(direction.energy)}${direction.energy === null && !energyPinned ? '' : mark(energyPinned)}`, ...ref });
    lines.push({ text: `  families ${direction.families ? direction.families.join(' ') : 'all'}${mark(override?.families !== undefined)}`, ...ref });
    lines.push(...lyricLines(program, paragraph, project, sourceLines));
    paragraph.shots.forEach((shot, index) => lines.push(...shotLines(program, paragraph, shot, index)));
    const transition = paragraph.transitionOut;
    const transitionOp = project.overrides.find(op => op.type === 'transition' && sameLine(op.anchor.line, paragraph.anchor.line)
        && !program.invalidOps.some(item => item.op === op));
    if (paragraph.index < program.paragraphs.length - 1) {
        const value = transitionOp?.type === 'transition' ? transitionOp.transition : transition?.id ?? 'none';
        const marker = !transitionOp ? '' : transitionOp.id.startsWith('ai-') ? ' @ai' : ' locked';
        const comment = note([transitionOp ? null : '自动', transition ? formatRange(transition.startTime, transition.endTime) : null]);
        lines.push({ text: `  transition ${value}${marker}${comment}`, ...ref });
    }
    lines.push({ text: '}', ...ref });
    return lines;
};

// ---------------------------------------------------------------------------------------------
// 片段

const assetName = (project: LumiProject, id: string) => project.assets.find(asset => asset.id === id)?.name ?? '素材库里没有';

const rangeNote = (timing: ClipTiming, program: LumiProgram) => {
    const range = resolveClipRange(timing, program);
    if (!range) return '锚点已失效';
    return timing.type === 'song' ? '全曲' : formatRange(range.start, range.end);
};

const backgroundLines = (project: LumiProject, program: LumiProgram, clip: BackgroundClip): ScriptLine[] => {
    const ref = { backgroundId: clip.id };
    const source = clip.source.type === 'image' || clip.source.type === 'video' ? `「${assetName(project, clip.source.assetId)}」` : null;
    return [
        { text: `background ${shortId(clip.id)} {${note([source, rangeNote(clip.timing, program)])}`, ...ref },
        { text: `  source ${formatSource(clip.source)}`, ...ref },
        { text: `  at ${formatTiming(clip.timing, program)}`, ...ref },
        { text: `  fit ${clip.fit}`, ...ref },
        { text: `  ken-burns ${num(clip.kenBurns)}`, ...ref },
        { text: `  blur ${num(clip.blur, 1)}`, ...ref },
        { text: `  dim ${num(clip.dim)}`, ...ref },
        { text: `  fade ${num(clip.fadeIn)} ${num(clip.fadeOut)}`, ...ref },
        { text: '}', ...ref },
    ];
};

const clipLines = (project: LumiProject, program: LumiProgram, clip: AssetClip): ScriptLine[] => {
    const ref = { clipId: clip.id };
    const effect = { ...DEFAULT_CLIP_EFFECT, ...clip.effect };
    const motion = { ...DEFAULT_CLIP_MOTION, ...clip.motion };
    const follow = clip.follow ?? 'off';
    return [
        { text: `clip ${shortId(clip.id)} {${note([`「${assetName(project, clip.assetId)}」`, rangeNote(clip.timing, program)])}`, ...ref },
        { text: `  asset ${shortId(clip.assetId)}`, ...ref },
        { text: `  at ${formatTiming(clip.timing, program)}`, ...ref },
        { text: `  extend ${num(clip.lead)} ${num(clip.tail)}  # 提前出现 / 延后消失（秒）`, ...ref },
        { text: `  slot ${clip.slot}`, ...ref },
        { text: `  position ${num(clip.x, 3)} ${num(clip.y, 3)}`, ...ref },
        { text: `  scale ${num(clip.scale, 3)}`, ...ref },
        { text: `  rotate ${num((clip.rotation * 180) / Math.PI, 1)}  # 度`, ...ref },
        { text: `  opacity ${num(clip.opacity)}`, ...ref },
        { text: `  flip ${clip.flipX ? 'on' : 'off'}`, ...ref },
        { text: `  blend ${clip.blend}`, ...ref },
        { text: `  follow ${follow}${follow === 'off' ? '' : ` ${num(clip.followAmount ?? 1)}`}`, ...ref },
        { text: `  enter ${clip.enter.type} ${num(clip.enter.duration)}`, ...ref },
        { text: `  exit ${clip.exit.type} ${num(clip.exit.duration)}`, ...ref },
        { text: `  effect ${effect.type === 'none' ? 'none' : `${effect.type} ${effect.color} ${num(effect.size)} ${num(effect.opacity)} ${num(effect.period)}`}`, ...ref },
        { text: `  motion ${motion.type === 'none' ? 'none' : `${motion.type} ${num(motion.amount)}`}`, ...ref },
        { text: '}', ...ref },
    ];
};

// ---------------------------------------------------------------------------------------------

export interface PrintInput {
    project: LumiProject;
    program: LumiProgram;
    /** 歌词文件里的行（套用修改之前）；没有歌词文件（纯音乐）时为 null。 */
    sourceLines: Line[] | null;
}

export const printScript = ({ project, program, sourceLines }: PrintInput): ProgramScript => {
    const shots = program.paragraphs.reduce((sum, paragraph) => sum + paragraph.shots.length, 0);
    const { direction } = project;
    const mix = mixAssignment(direction);
    const lines: ScriptLine[] = [
        { text: '# lumisynth 剧本 · 只写场景编排；主题、字体、画幅、tuning 在「设置」标签里' },
        { text: '# 直接改编排结果：改了的值固定下来（标 locked），没改的保持自动；去掉 locked 交回自动。注释（「# 」后面）改了不影响。Ctrl+S 应用（一步撤销）' },
        { text: `# ${program.paragraphs.length} 段 · ${shots} 个镜头 · ${program.lines.length} 行${sourceLines ? '歌词' : '（纯音乐）'} · 分段阈值 ${num(program.paragraphGapThreshold)} 秒` },
        { text: `lumiscript ${SCRIPT_VERSION}` },
        { text: `seed ${quote(project.seed)}` },
        { text: `direction ${direction.mode === 'single' ? `single ${direction.pack}` : 'mix'}` },
        ...PARAGRAPH_KINDS.filter(kind => mix[kind] !== DEFAULT_MIX_BY_KIND[kind]).map(kind => ({ text: `mix ${kind} ${mix[kind]}${note([`${KIND_LABELS[kind]}用 ${mix[kind]}`])}` })),
        { text: `shot-mixing ${direction.shotMixing ? 'on' : 'off'}  # 段内可以出现别的包的镜头` },
        { text: `lyric-offset ${num(project.lyricEdits.offset)}  # 歌词整体偏移（秒，正值推迟）；line 的时间不含它` },
        { text: '' },
    ];
    program.paragraphs.forEach(paragraph => {
        lines.push(...paragraphLines(program, paragraph, project, sourceLines));
        lines.push({ text: '' });
    });
    lines.push({ text: '# 背景轨：后面的盖住前面的，空档露出默认背景' });
    if (project.backgroundClips.length === 0) lines.push({ text: 'backgrounds none' });
    project.backgroundClips.forEach(clip => lines.push(...backgroundLines(project, program, clip)));
    lines.push({ text: '' }, { text: '# 素材片段' });
    if (project.assetClips.length === 0) lines.push({ text: 'clips none' });
    project.assetClips.forEach(clip => lines.push(...clipLines(project, program, clip)));

    if (project.assets.length > 0) {
        lines.push({ text: '' }, { text: '# 素材库（asset / source 写 id 的前几位，或者 "文件名"）' });
        project.assets.forEach(asset => lines.push({ text: `#   ${shortId(asset.id)}  ${quote(asset.name)}  ${asset.kind === 'video' ? '视频（只能用作背景）' : '图片'}` }));
    }
    const invalid = [
        ...program.invalidOps.map(({ op, reason }) => `${op.type} @ 第 ${('line' in op.anchor ? op.anchor.line : op.anchor).index + 1} 行：${reason}`),
        ...program.invalidDirections.map(item => `段落编排 @ 第 ${item.anchor.line.index + 1} 行：段首行已不存在或包没有安装`),
        ...program.invalidStructureEdits.map(({ edit, reason }) => `${edit.type} @ 第 ${edit.anchor.index + 1} 行：${reason}`),
    ];
    if (invalid.length > 0) {
        lines.push({ text: '' }, { text: '# 没有生效的修改：剧本写不出来，应用剧本时原样保留（在「问题」面板里处理）' });
        invalid.forEach(item => lines.push({ text: `#   ${item}` }));
    }
    while (lines.at(-1)?.text === '') lines.pop();
    return { lines, text: `${lines.map(line => line.text).join('\n')}\n` };
};

/** 原始 JSON：去掉各包的原生结构（很大，也不是给人读的），其余照原样。 */
export const programToJson = (program: LumiProgram, includeNative = false) => JSON.stringify(program, (key, value) => {
    if (!includeNative && (key === 'native' || key === 'segments')) return undefined;
    return value;
}, 2);
