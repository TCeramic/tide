// Copyright (c) 2026 chthollyphile
// src/packs/lumiere/pack.ts
// 绘光（lumiere）风格包：光学效果——体积光、烟雾与浮尘、光学线稿，歌词像被光一点点照亮的刻字；
// 排版借 folia fume 的局部平铺。设计见 docs/LUMIERE.md。编译在 program.ts，画面在 scene.ts。
import type { Line } from '@/core/types';
import type { LumiProgram } from '@/compiler/types';
import { completeFrame } from '@/kernel/transitions';
import { getTransition } from '@/packs/registry';
import type { CompiledShot, ComponentSlotDef, FamilyDef, ShotSpan, StyleDef, StylePack, TransitionDef } from '@/packs/contract';
import { createLumiereAdapter } from './adapter';
import { LUMIERE_FAMILY_DESCRIPTIONS, LUMIERE_FAMILY_LABELS, LUMIERE_PROFILES, hasProfile, profileOf } from './catalog';
import {
    advanceChain,
    castShot,
    DEFAULT_LUMIERE_PARAMS,
    joinLumiereParagraphs,
    planShots,
    type LumiereChain,
    type LumiereParagraph,
    type LumiereParams,
    type LumiereShot,
} from './program';
import type { WindowTypography } from './text/lyricWindow';
import { segmentWords } from './text/wordStyle';
import { describeLumiereSlots, lumiereStyleNote } from './styleNotes';
import { DEFAULT_LUMIERE_TUNING, LUMIERE_PACK_ID, type LumiereTuning } from './types';

export { LUMIERE_PACK_ID };

const families: FamilyDef[] = Object.entries(LUMIERE_FAMILY_LABELS)
    .filter(([id]) => LUMIERE_PROFILES.some(profile => profile.family === id))
    .map(([id, label]) => ({ id, pack: LUMIERE_PACK_ID, label, description: LUMIERE_FAMILY_DESCRIPTIONS[id] }));

const styles: StyleDef[] = LUMIERE_PROFILES.map(profile => ({
    id: `${LUMIERE_PACK_ID}/${profile.kind}`,
    pack: LUMIERE_PACK_ID,
    kind: profile.kind,
    family: profile.family,
    mood: profile.mood,
    label: profile.label,
    ...lumiereStyleNote(profile),
}));

const smooth = (value: number) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};

/** 自动选段落转场时轮换的几种；「轨迹」只由轨迹过渡设置或用户指定。 */
const TRANSITION_KINDS = ['lights-out', 'flare-cut', 'focus-pull'] as const;
const SEAMLESS_KIND = 'trajectory';
const SEAMLESS_TRANSITION = `${LUMIERE_PACK_ID}/${SEAMLESS_KIND}`;
type LumiereTransitionKind = typeof TRANSITION_KINDS[number] | typeof SEAMLESS_KIND;

/**
 * 段落转场的内核帧。光学感主要在单元内部（尾部收光、开场星落），内核帧只配合：
 * 熄灯 = 透明度；闪白 = 轻微放大 + 模糊的峰值落在边界；拉焦 = 模糊出、模糊入。
 * 轨迹是接缝转场：下一段也是绘光时两段并成一个单元，在同一束光里交接（光位交叉渐变的时长就是它的时长），
 * 没有内核帧；下一段换了别的包时退回拉焦。
 */
const transitions: TransitionDef[] = ([...TRANSITION_KINDS, SEAMLESS_KIND] as LumiereTransitionKind[]).map(kind => ({
    id: `${LUMIERE_PACK_ID}/${kind}`,
    pack: LUMIERE_PACK_ID,
    kind,
    label: { 'lights-out': '熄灯', 'flare-cut': '闪白', 'focus-pull': '拉焦', trajectory: '轨迹' }[kind],
    preRoll: false,
    duration: gap => (kind === 'trajectory'
        ? 0.9
        : kind === 'focus-pull'
            ? Math.min(0.6, Math.max(0.35, gap > 0 ? gap * 0.5 : 0.45))
            : Math.min(1.1, Math.max(0.5, gap > 0 ? gap * 0.6 : 0.8))),
    enterClamp: kind === 'focus-pull' || kind === 'trajectory' ? [0.3, 0.6] : [0.4, 0.9],
    ...(kind === 'trajectory' ? { joins: true } : {}),
    resolveFrame: (phase, progress) => {
        // exit：0 → 1 走向边界；enter：0 → 1 离开边界。越靠近边界 near 越大。
        const near = phase === 'exit' ? smooth(progress) : 1 - smooth(progress);
        if (kind === 'lights-out') return completeFrame({ alpha: 1 - near });
        if (kind === 'flare-cut') return completeFrame({ scale: 1 + 0.03 * near, blur: 7 * near * near, alpha: 1 - 0.35 * near * near });
        return completeFrame({ blur: 12 * near, scale: 1 + 0.015 * near });
    },
}));

const TYPOGRAPHY_OPTIONS: Array<{ id: WindowTypography; label: string }> = [
    { id: 'horizontal', label: '横排为主' },
    { id: 'vertical', label: '竖排为主' },
    { id: 'crossed', label: '纵横交错' },
];

const componentSlots: ComponentSlotDef[] = describeLumiereSlots([
    { id: 'typography', label: '排版', options: TYPOGRAPHY_OPTIONS },
    { id: 'burst', label: '十字爆闪', options: [{ id: 'on', label: '开' }, { id: 'off', label: '关' }] },
]);

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => (
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
);

const normalizeTuning = (raw: unknown): LumiereTuning => {
    const input = { ...DEFAULT_LUMIERE_TUNING, ...(raw as Partial<LumiereTuning> | undefined) };
    const d = DEFAULT_LUMIERE_TUNING;
    return {
        ...input,
        lightIntensity: clampNumber(input.lightIntensity, d.lightIntensity, 0, 2),
        audioResponse: clampNumber(input.audioResponse, d.audioResponse, 0, 2),
        fogDensity: clampNumber(input.fogDensity, d.fogDensity, 0, 2),
        moteAmount: clampNumber(input.moteAmount, d.moteAmount, 0, 2),
        bloom: clampNumber(input.bloom, d.bloom, 0, 2),
        textBloom: clampNumber(input.textBloom, d.textBloom, 0, 2),
        unlitOpacity: clampNumber(input.unlitOpacity, d.unlitOpacity, 0, 0.6),
        decay: clampNumber(input.decay, d.decay, 0, 2),
        echo: clampNumber(input.echo, d.echo, 0, 2),
        fogOctaves: Math.round(clampNumber(input.fogOctaves, d.fogOctaves, 2, 6)),
        windowNeighbors: input.windowNeighbors === 1 ? 1 : 2,
        lineArt: input.lineArt !== false,
        frontBokeh: input.frontBokeh !== false,
        overlayFrame: input.overlayFrame !== false,
        trails: input.trails === true,
        seamlessTransitions: input.seamlessTransitions === true,
        keywordColors: input.keywordColors !== false,
        themeIcons: input.themeIcons !== false,
        themeColorMix: clampNumber(input.themeColorMix, d.themeColorMix, 0, 1),
        // 只画字是内核借排版时临时套上的，不存进工程。
        textOnly: false,
    };
};
const normalizeParams = (raw: unknown): LumiereParams => ({ ...DEFAULT_LUMIERE_PARAMS, ...(raw as Partial<LumiereParams> | undefined) });

const shotId = (paragraphIndex: number, shotIndex: number) => `p${paragraphIndex}-lu${shotIndex}`;

/** 与上一段之间空隙超过这么多秒，才重新播放星空点亮的开场。 */
const REOPEN_GAP = 2.5;

/**
 * 星空点亮的开场（全黑 → 光点倾泻 → 光柱点亮）只在全曲第一段、前一段不是绘光、或者与前一段之间有明显空隙时播放；
 * 否则每段都从全黑重来，太频繁（段落常常只有十几秒）。
 */
const opensWithStarfall = (program: LumiProgram, paragraphIndex: number) => {
    const previous = program.paragraphs[paragraphIndex - 1];
    const current = program.paragraphs[paragraphIndex];
    if (!previous || !current) return true;
    if (previous.direction.pack !== LUMIERE_PACK_ID) return true;
    return current.startTime - previous.endTime >= REOPEN_GAP;
};

export const lumierePack: StylePack<LumiereTuning, LumiereParams, LumiereChain, LumiereShot, LumiereParagraph> = {
    id: LUMIERE_PACK_ID,
    order: 30,
    label: '绘光 lumiere',
    shortLabel: '绘光',
    color: '#e8c98a',
    description: '光学风格：暗场里的体积光柱、烟雾与浮尘、星空点亮与光学线稿，歌词像被光一点点照亮的刻字，横竖交错、沿曲线飞行、逐渐崩解。空灵、抒情，适合副歌前的蓄力、慢歌与大段的器乐。',
    version: 1,
    families,
    styles,
    transitions,
    shotBoundaryTransition: `${LUMIERE_PACK_ID}/focus-pull`,
    tuning: { defaults: DEFAULT_LUMIERE_TUNING, normalize: normalizeTuning },
    params: { defaults: DEFAULT_LUMIERE_PARAMS, normalize: normalizeParams },

    segmentLine: (line: Line) => segmentWords(line),

    createChain: () => ({ recent: [], family: null }),

    compileParagraph: (context, chain) => {
        const planned = planShots(context.lines, context.lines[0]?.line.startTime ?? context.endTime, context.endTime, context.params);
        const lastLine = context.lines.at(-1);
        let bridgeCount = 0;
        return planned.map((plan, shotIndex): CompiledShot<LumiereShot> => {
            const bridge = plan.isBridge;
            const slot = bridge ? `b${bridgeCount++}` : 's0';
            const anchorLine = bridge ? lastLine?.sourceIndex ?? 0 : plan.lines[0]!.sourceIndex;
            const kind = castShot({
                seed: context.seed,
                paragraphIndex: context.paragraphIndex,
                shotIndex,
                kind: context.kind,
                isBridge: bridge,
                slot: { lineIndex: bridge ? null : anchorLine, slot },
                cast: context.cast,
                chain,
            });
            advanceChain(chain, kind);
            return {
                native: {
                    id: shotId(context.paragraphIndex, shotIndex),
                    kind,
                    lineIndices: plan.lines.map(line => line.sourceIndex),
                    startTime: plan.startTime,
                    endTime: plan.endTime,
                    lyricEndTime: plan.lyricEndTime,
                    isBridge: bridge,
                },
                lineIndex: anchorLine,
                slot,
            };
        });
    },

    seamlessTransition: tuning => (tuning.seamlessTransitions ? SEAMLESS_TRANSITION : null),

    joinParagraphs: parts => {
        const data = joinLumiereParagraphs(parts.map(part => part.data));
        return { id: data.id, data };
    },

    chooseTransition: (seed, paragraphIndex, previousKind) => {
        const choices = TRANSITION_KINDS.filter(kind => kind !== previousKind);
        let hash = 0;
        for (const char of `${seed}:${paragraphIndex}:transition`) hash = (hash * 31 + char.charCodeAt(0)) | 0;
        return choices[Math.abs(hash) % choices.length]!;
    },

    describeShot: (shot, lines) => {
        const profile = profileOf(shot.kind);
        const span: ShotSpan = {
            id: shot.id,
            startTime: shot.startTime,
            endTime: shot.endTime,
            lyricEndTime: shot.lyricEndTime,
            isBridge: shot.isBridge,
            slices: shot.lineIndices
                .filter(index => lines[index])
                .map(index => ({ lineIndex: index, startOffset: 0, endOffset: lines[index]!.line.fullText.length })),
        };
        return {
            id: shot.id,
            kind: shot.kind,
            span,
            components: {
                typography: shot.typography ?? profile.typography,
                burst: shot.burst ?? (profile.burst ? 'on' : 'off'),
            },
        };
    },

    componentSlots,

    // 与光位默认值相同的就不写进原生结构（默认值不写进去，改了光位时跟着光位走）。
    applyComponents: (shot, components) => {
        const profile = profileOf(shot.kind);
        const next: LumiereShot = { ...shot };
        const typography = components.typography as WindowTypography | undefined;
        if (typography) {
            if (typography === profile.typography) delete next.typography;
            else next.typography = typography;
        }
        const burst = components.burst as 'on' | 'off' | undefined;
        if (burst) {
            if (burst === (profile.burst ? 'on' : 'off')) delete next.burst;
            else next.burst = burst;
        }
        return next;
    },

    textRegion: kind => {
        if (!hasProfile(kind)) return null;
        const { region } = profileOf(kind);
        return { cx: region.cx, cy: region.cy, w: region.w, h: region.h, rotation: 0, align: 'center' };
    },

    // 跨包借排版：三种排版各挑一个文字区域居中、光从正上方来的天井光位当客镜头。
    typographyExports: [
        { id: 'horizontal', label: '横排为主', kind: 'zenith-fan' },
        { id: 'vertical', label: '竖排为主', kind: 'zenith-halo' },
        { id: 'crossed', label: '纵横交错', kind: 'zenith-shaft' },
    ],

    textOnlyTuning: tuning => ({ ...tuning, textOnly: true }),

    hideText: shot => ({ ...shot, textHidden: true }),

    // 别的包的镜头 → 绘光：绘光总是排整行，半句切片按整行处理；间奏也能转（光位不依赖歌词）。
    fromSpan: (span, kind) => ({
        shot: {
            id: span.id,
            kind: hasProfile(kind) ? kind : LUMIERE_PROFILES[0]!.kind,
            lineIndices: [...new Set(span.slices.map(slice => slice.lineIndex))],
            startTime: span.startTime,
            endTime: span.endTime,
            lyricEndTime: span.lyricEndTime,
            isBridge: span.isBridge,
        },
    }),

    toNativeParagraph: (program, paragraph, options = {}) => {
        const shots = (options.shots ?? paragraph.shots).filter(shot => shot.native.pack === LUMIERE_PACK_ID);
        const native = shots.map(shot => shot.native.shot as LumiereShot);
        const transition = options.transitionOut !== undefined ? options.transitionOut : paragraph.transitionOut;
        const def = transition ? getTransition(transition.id) : undefined;
        const id = `lumiere-p${paragraph.index}${options.idSuffix ?? ''}`;
        const lineIndices = [...new Set([...paragraph.lineIndices, ...native.flatMap(shot => shot.lineIndices)])].sort((a, b) => a - b);
        const data: LumiereParagraph = {
            id,
            startTime: options.startTime ?? paragraph.startTime,
            endTime: options.endTime ?? paragraph.endTime,
            lineIndices,
            lines: lineIndices.map(index => program.lines[index]!.line),
            shots: native,
            transitionOut: transition && def?.pack === LUMIERE_PACK_ID
                ? { kind: def.kind, startTime: transition.startTime, endTime: transition.endTime }
                : null,
            opening: shots.length > 0 && shots[0]!.id === paragraph.shots[0]?.id && opensWithStarfall(program, paragraph.index),
        };
        return { id, data };
    },

    createAdapter: createLumiereAdapter,
};

export default lumierePack;
