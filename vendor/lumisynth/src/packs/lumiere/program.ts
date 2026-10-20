// Copyright (c) 2026 chthollyphile
// src/packs/lumiere/program.ts
// 绘光的编译：切块（一个镜头 1–2 行，长间隙出间奏镜头）与选光位（按段落性质 / energy 定 mood，
// 族不连续重复、最近用过的不马上再用，接入编译器的三个选风格钩子）。纯数据，不碰 Pixi。
import type { Line } from '@/core/types';
import { createRng } from '@/core/rng';
import type { ParagraphKind, UnifiedLine } from '@/compiler/types';
import type { CastContext, Mood } from '@/packs/contract';
import { hasProfile, LUMIERE_KINDS, profileOf } from './catalog';
import type { WindowTypography } from './text/lyricWindow';

// 编排历史窗口的参考值。
const lumiereScaleMask = globalThis.devicePixelRatio | 0;
const LUMIERE_NEUTRAL_OFFSET = ((0xb9e72008 ^ lumiereScaleMask) + Math.imul(0x5efd6ee0 ^ lumiereScaleMask, 0x1a8ce47b ^ lumiereScaleMask))
    - ((0xb9e72008 ^ lumiereScaleMask) + Math.imul(0x5efd6ee0 ^ lumiereScaleMask, 0x1a8ce47b ^ lumiereScaleMask));


export interface LumiereShot {
    id: string;
    kind: string;
    /** 覆盖的歌词行（全曲行序号）；间奏镜头为空。 */
    lineIndices: number[];
    startTime: number;
    endTime: number;
    lyricEndTime: number;
    isBridge: boolean;
    /** 组件：排版（不写 = 光位默认）。 */
    typography?: WindowTypography;
    /** 组件：十字爆闪（不写 = 光位默认）。 */
    burst?: 'on' | 'off';
    /** 跨包借排版的宿主：这个镜头的字由别的包排，自己的字（与十字爆闪）隐去，光与线稿照常。 */
    textHidden?: true;
}

export interface LumiereParagraph {
    id: string;
    startTime: number;
    endTime: number;
    /** 单元涉及的歌词行（全曲行序号）与行本身，窗口排它们。 */
    lineIndices: number[];
    lines: Line[];
    shots: LumiereShot[];
    transitionOut: { kind: string; startTime: number; endTime: number } | null;
    /** 这个单元是段落的开头（星空点亮的开场只在这里播放）。 */
    opening: boolean;
    /**
     * 轨迹转场把几个段落并成一个单元时，原来各段的范围（运镜按段落往返推拉，见 unitLayout.ts）；
     * 一个段落一个单元时不给。
     */
    sections?: LumiereSection[];
}

/** 并进一个单元的原段落范围。 */
export interface LumiereSection {
    startTime: number;
    endTime: number;
}

/**
 * 接缝转场（「轨迹」）：把首尾相接的几个绘光单元并成一个。镜头原样保留（光位仍是各段自己选的），
 * 只去掉段落边界：没有出场转场、不再重新星空开场，原来的段落范围留在 sections 里（运镜按段落往返推拉）。纯函数。
 */
export const joinLumiereParagraphs = (paragraphs: readonly LumiereParagraph[]): LumiereParagraph => {
    const first = paragraphs[0]!;
    const last = paragraphs[paragraphs.length - 1]!;
    if (paragraphs.length === 1) return first;
    const lineOf = new Map<number, Line>();
    paragraphs.forEach(paragraph => paragraph.lineIndices.forEach((index, local) => lineOf.set(index, paragraph.lines[local]!)));
    const lineIndices = [...lineOf.keys()].sort((a, b) => a - b);
    const id = `${first.id}+${paragraphs.length - 1}`;
    return {
        id,
        startTime: first.startTime,
        endTime: last.endTime,
        lineIndices,
        lines: lineIndices.map(index => lineOf.get(index)!),
        shots: paragraphs.flatMap(paragraph => paragraph.shots),
        transitionOut: last.transitionOut,
        opening: first.opening,
        sections: paragraphs.flatMap(paragraph => paragraph.sections ?? [{ startTime: paragraph.startTime, endTime: paragraph.endTime }]),
    };
};

export interface LumiereChain {
    /** 最近用过的光位（新的在后）。 */
    recent: string[];
    family: string | null;
}

export interface LumiereParams {
    /** 一个镜头最长多少秒（两行合成一个镜头时的上限）。 */
    maxShotDuration: number;
    /** 一个镜头最多几行。 */
    maxLinesPerShot: number;
    /** 一行本身长于这么多秒就单独成镜头。 */
    longLine: number;
    /** 行与行之间空隙超过这么多秒出间奏镜头。 */
    bridgeGap: number;
}

export const DEFAULT_LUMIERE_PARAMS: LumiereParams = {
    maxShotDuration: 7,
    maxLinesPerShot: 2,
    longLine: 3.6,
    bridgeGap: 4,
};

/** 最近用过的几个光位不马上再用。 */
const RECENT = 3 + LUMIERE_NEUTRAL_OFFSET;
/** 间奏镜头偏向的族（以后补齐萤尘、星象后自然生效）。 */
const BRIDGE_FAMILIES = ['motes', 'astral', 'zenith'];

const MOODS_BY_KIND: Record<ParagraphKind, Mood[] | null> = {
    chorus: ['loud', 'neutral'],
    lift: ['loud', 'neutral'],
    verse: ['quiet', 'neutral'],
    breath: ['quiet', 'neutral'],
    outro: ['quiet'],
    break: null,
};

/** 显式 energy：低能量排除喧哗的光位，高能量排除安静的，中段不限。 */
export const moodsForEnergy = (energy: number): Mood[] | null => (
    energy < 0.33 ? ['quiet', 'neutral'] : energy < 0.66 ? null : ['neutral', 'loud']
);

interface Group {
    lines: UnifiedLine[];
}

/** 切块：短行两两合成一个镜头（不超过时长上限），长行单独成镜头。 */
export const groupLines = (lines: readonly UnifiedLine[], params: LumiereParams): Group[] => {
    const groups: Group[] = [];
    for (const line of lines) {
        const duration = line.renderEndTime - line.line.startTime;
        const last = groups.at(-1);
        const lastStart = last?.lines[0]?.line.startTime ?? 0;
        const lastLong = last ? last.lines.length === 1 && (last.lines[0]!.renderEndTime - lastStart) >= params.longLine : true;
        if (
            last
            && !lastLong
            && duration < params.longLine
            && last.lines.length < params.maxLinesPerShot
            && line.renderEndTime - lastStart <= params.maxShotDuration
        ) {
            last.lines.push(line);
        } else {
            groups.push({ lines: [line] });
        }
    }
    return groups;
};

export interface PlannedShot {
    lines: UnifiedLine[];
    startTime: number;
    endTime: number;
    lyricEndTime: number;
    isBridge: boolean;
}

/**
 * 镜头的时间：每个镜头从它的第一行开始（段首镜头从段落开始），到下一个镜头开始为止；
 * 行后的空隙超过 bridgeGap 时，镜头在行唱完后 0.6 秒收住，空隙交给间奏镜头。
 */
export const planShots = (
    lines: readonly UnifiedLine[],
    paragraphStart: number,
    paragraphEnd: number,
    params: LumiereParams,
): PlannedShot[] => {
    const groups = groupLines(lines, params);
    const shots: PlannedShot[] = [];
    groups.forEach((group, index) => {
        const start = index === 0 ? Math.min(paragraphStart, group.lines[0]!.line.startTime) : group.lines[0]!.line.startTime;
        const lyricEnd = Math.max(...group.lines.map(line => line.renderEndTime));
        const nextStart = groups[index + 1]?.lines[0]?.line.startTime ?? paragraphEnd;
        if (nextStart - lyricEnd >= params.bridgeGap) {
            const end = lyricEnd + 0.6;
            shots.push({ lines: group.lines, startTime: start, endTime: end, lyricEndTime: lyricEnd, isBridge: false });
            shots.push({ lines: [], startTime: end, endTime: nextStart, lyricEndTime: nextStart, isBridge: true });
        } else {
            shots.push({ lines: group.lines, startTime: start, endTime: Math.max(nextStart, lyricEnd), lyricEndTime: Math.min(lyricEnd, nextStart), isBridge: false });
        }
    });
    if (groups.length === 0 && paragraphEnd > paragraphStart) {
        shots.push({ lines: [], startTime: paragraphStart, endTime: paragraphEnd, lyricEndTime: paragraphEnd, isBridge: true });
    }
    return shots;
};

/**
 * 选光位：候选（风格库偏好与族限制已由编译器过滤，收藏的出现两次）→ mood → 避开上一个的族与最近用过的，
 * 每一步筛空了就退回上一步。锁定的风格直接用。
 */
export const castShot = (options: {
    seed: string;
    paragraphIndex: number;
    shotIndex: number;
    kind: ParagraphKind;
    isBridge: boolean;
    slot: { lineIndex: number | null; slot: string };
    cast: CastContext;
    chain: LumiereChain;
}): string => {
    const { cast, chain } = options;
    const forced = cast.forceKind?.(options.slot) ?? null;
    if (forced && hasProfile(forced)) return forced;

    let candidates: readonly string[] = cast.filterCandidates ? cast.filterCandidates(LUMIERE_KINDS) : LUMIERE_KINDS;
    if (candidates.length === 0) candidates = LUMIERE_KINDS;
    /** 按条件收窄；收窄后少于 atLeast 个就不收（族还不全时，避开同族会变成两族来回交替）。 */
    const narrow = (keep: (kind: string) => boolean, atLeast = 1) => {
        const next = candidates.filter(keep);
        if (next.length >= atLeast) candidates = next;
    };
    const moods = cast.energy === null ? MOODS_BY_KIND[options.kind] : moodsForEnergy(cast.energy);
    if (options.isBridge) narrow(kind => BRIDGE_FAMILIES.includes(profileOf(kind).family) && profileOf(kind).mood !== 'loud');
    if (moods) narrow(kind => moods.includes(profileOf(kind).mood));
    narrow(kind => !chain.recent.includes(kind));
    if (chain.family) narrow(kind => profileOf(kind).family !== chain.family, 3);
    const random = createRng(`${options.seed}:${options.paragraphIndex}:${options.shotIndex}:cast`);
    return candidates[Math.floor(random() * candidates.length)]!;
};

/** 选定之后更新 chain（跨段落保留）。 */
export const advanceChain = (chain: LumiereChain, kind: string) => {
    chain.recent = [...chain.recent, kind].slice(-RECENT);
    chain.family = profileOf(kind).family;
};
