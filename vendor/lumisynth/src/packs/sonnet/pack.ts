// src/packs/sonnet/pack.ts
// 商籁（sonnet）风格包：排字运动 + MG。编译逻辑在 sonnetProgram.ts（folia 原版，加了编排钩子）。
import type { Line } from '@/core/types';
import { getTransition } from '@/packs/registry';
import type { CompiledShot, ComponentSlotDef, FamilyDef, ShotSpan, StyleDef, StylePack, TextRegion, TransitionDef } from '@/packs/contract';
import { fromSonnetFrame } from '@/kernel/transitions';
import type { UnifiedLine } from '@/compiler/types';
import { createSonnetAdapter } from './adapter';
import {
    buildCues,
    buildShots,
    buildSonnetSemanticSegments,
    buildSonnetShotCamera,
    chooseWithoutRepeat,
    SONNET_SHOT_KINDS,
    type SonnetCastHooks,
} from './sonnetProgram';
import { resolveSonnetTransitionEffectFrame } from './sonnetTransitions';
import { DEFAULT_SONNET_TUNING, type SonnetTuning } from './sonnetTuning';
import {
    SONNET_ACCENTS,
    SONNET_TRANSITION_KINDS,
    type SonnetAccent,
    type SonnetCompiledLine,
    type SonnetParagraph,
    type SonnetSemanticSegment,
    type SonnetShot,
    type SonnetShotKind,
    type SonnetTransitionKind,
} from './types';
import { describeSonnetSlots, SONNET_FAMILY_DESCRIPTIONS, SONNET_STYLE_NOTES } from './sonnetStyleNotes';

export const SONNET_PACK_ID = 'sonnet';

export interface SonnetParams {
    /** 一个 shot 最多几行、最长几秒。 */
    groupMaxLines: number;
    groupMaxSeconds: number;
}

export const DEFAULT_SONNET_PARAMS: SonnetParams = { groupMaxLines: 4, groupMaxSeconds: 6 };

interface SonnetChain {
    shot: SonnetShotKind | null;
}

/** 从 tempera 半句切片等转来的镜头携带的「伪行」（只含切片内的片段、负行序号）。 */
interface SonnetShotExtra {
    lines: SonnetCompiledLine[];
}

const FAMILY_KINDS: Array<[string, string, SonnetShotKind[]]> = [
    ['typography', '排字', ['editorial-column', 'type-impact', 'tracking-ribbon']],
    ['collage', '拼贴', ['fragment-collage', 'poster-blocks']],
    ['reveal', '遮罩', ['mask-reveal']],
    ['tableau', '静景', ['quiet-tableau']],
];

const MOODS: Record<SonnetShotKind, StyleDef['mood']> = {
    'editorial-column': 'neutral',
    'type-impact': 'loud',
    'fragment-collage': 'neutral',
    'tracking-ribbon': 'neutral',
    'mask-reveal': 'neutral',
    'poster-blocks': 'loud',
    'quiet-tableau': 'quiet',
};

// 路线 E：商籁的构图（镜头运动、MG）与排字方式原本由同一个 kind 决定；排版槽让一个镜头借用
// 另一种 kind 的排字方式。选项 id 就是 kind，默认值（与构图相同）不写进原生结构。
const TYPOGRAPHY_LABELS: Record<SonnetShotKind, string> = {
    'editorial-column': '编辑栏',
    'type-impact': '冲击大字',
    'fragment-collage': '碎片拼贴',
    'tracking-ribbon': '字距飘带',
    'mask-reveal': '遮罩揭示',
    'poster-blocks': '海报块',
    'quiet-tableau': '静景',
};

const ACCENT_LABELS: Record<SonnetAccent | 'standard', string> = {
    standard: '标准',
    geo: '中央几何',
    hud: '仅线框',
    none: '无',
};

const componentSlots: ComponentSlotDef[] = describeSonnetSlots([
    { id: 'typography', label: '排版', options: SONNET_SHOT_KINDS.map(kind => ({ id: kind, label: TYPOGRAPHY_LABELS[kind] })) },
    { id: 'accent', label: '点缀', options: (['standard', ...SONNET_ACCENTS] as const).map(id => ({ id, label: ACCENT_LABELS[id] })) },
]);

/** 商籁的字排在整个安全区里（镜头会跟着字走），海报块略小。 */
const textRegionOf = (kind: SonnetShotKind): TextRegion => (
    kind === 'poster-blocks'
        ? { cx: 0.5, cy: 0.5, w: 0.84, h: 0.8, rotation: 0, align: 'left' }
        : kind === 'quiet-tableau'
            ? { cx: 0.5, cy: 0.5, w: 0.72, h: 0.64, rotation: 0, align: 'center' }
            : { cx: 0.5, cy: 0.48, w: 0.92, h: 0.86, rotation: 0, align: 'center' }
);

const families: FamilyDef[] = FAMILY_KINDS.map(([id, label]) => ({ id, pack: SONNET_PACK_ID, label, description: SONNET_FAMILY_DESCRIPTIONS[id] }));

const styles: StyleDef[] = SONNET_SHOT_KINDS.map(kind => ({
    id: `${SONNET_PACK_ID}/${kind}`,
    pack: SONNET_PACK_ID,
    kind,
    family: FAMILY_KINDS.find(([, , kinds]) => kinds.includes(kind))![0],
    mood: MOODS[kind],
    ...SONNET_STYLE_NOTES[kind],
}));

const TRANSITION_LABELS: Record<SonnetTransitionKind, string> = {
    'fast-blur': '快速模糊',
    'mono-glitch': '单色故障',
    'camera-pull': '镜头拉远',
};

const transitions: TransitionDef[] = SONNET_TRANSITION_KINDS.map(kind => ({
    id: `${SONNET_PACK_ID}/${kind}`,
    pack: SONNET_PACK_ID,
    kind,
    label: TRANSITION_LABELS[kind],
    preRoll: false,
    duration: gap => Math.min(0.3, Math.max(0.16, gap > 0 ? gap * 0.5 : 0.2)),
    enterClamp: [0.16, 0.3],
    resolveFrame: (phase, progress, context) => fromSonnetFrame(resolveSonnetTransitionEffectFrame(kind, phase, progress, context.transitionSeed)),
}));

const segmentsOf = (line: UnifiedLine) => line.segments[SONNET_PACK_ID] as SonnetSemanticSegment[];

const compiledLine = (line: UnifiedLine): SonnetCompiledLine => ({
    sourceIndex: line.sourceIndex,
    line: line.line,
    renderEndTime: line.renderEndTime,
    segments: segmentsOf(line),
});

/** 伪行序号：负数，不会与真实行冲突。 */
const pseudoIndex = (paragraphIndex: number, shotIndex: number, slice: number) => -(paragraphIndex * 4096 + shotIndex * 16 + slice + 1);

const normalizeTuning = (raw: unknown): SonnetTuning => ({ ...DEFAULT_SONNET_TUNING, ...(raw as Partial<SonnetTuning> | undefined) });
const normalizeParams = (raw: unknown): SonnetParams => ({ ...DEFAULT_SONNET_PARAMS, ...(raw as Partial<SonnetParams> | undefined) });

/** 显式 energy：低能量排除喧哗的构图，高能量排除安静的，中段不限。 */
const moodsForEnergy = (energy: number): StyleDef['mood'][] | null => (
    energy < 0.33 ? ['quiet', 'neutral'] : energy < 0.66 ? null : ['neutral', 'loud']
);

export const sonnetPack: StylePack<SonnetTuning, SonnetParams, SonnetChain, SonnetShot, SonnetParagraph> = {
    id: SONNET_PACK_ID,
    order: 20,
    label: '商籁 sonnet',
    shortLabel: '商籁',
    color: '#0ea5e9',
    description: '排字运动：大字号层级排版、镜头逐字追踪焦点、细线引导与 MG 图形装饰，段内镜头之间是快速的模糊 / 故障切换。精致、叙述感强，适合主歌、换气与尾声。',
    version: 1,
    families,
    styles,
    transitions,
    shotBoundaryTransition: `${SONNET_PACK_ID}/fast-blur`,
    tuning: { defaults: DEFAULT_SONNET_TUNING, normalize: normalizeTuning },
    params: { defaults: DEFAULT_SONNET_PARAMS, normalize: normalizeParams },

    segmentLine: (line: Line) => buildSonnetSemanticSegments(line),

    createChain: () => ({ shot: null }),

    compileParagraph: (context, chain) => {
        const { cast, params } = context;
        const moods = cast.energy === null ? null : moodsForEnergy(cast.energy);
        const moodFilter = moods === null
            ? null
            : (defaults: readonly string[]) => defaults.filter(kind => moods.includes(MOODS[kind as SonnetShotKind]));
        const baseFilter = cast.filterCandidates;
        const filter = baseFilter && moodFilter
            ? (defaults: readonly string[]) => baseFilter(moodFilter(defaults))
            : baseFilter ?? moodFilter;
        const hooks: SonnetCastHooks = {
            candidates: filter ? defaults => filter(defaults) as readonly SonnetShotKind[] : undefined,
            kindRules: cast.energy === null,
            forceKind: cast.forceKind ? slot => cast.forceKind!(slot) as SonnetShotKind | null : undefined,
            group: { maxLines: params.groupMaxLines, maxSeconds: params.groupMaxSeconds },
        };
        const shots = buildShots(context.lines.map(compiledLine), context.kind, context.paragraphIndex, context.seed, chain.shot, hooks);
        chain.shot = shots.at(-1)?.kind ?? chain.shot;
        return shots.map((shot): CompiledShot<SonnetShot> => ({ native: shot, lineIndex: shot.lineIndices[0], slot: 's0' }));
    },

    chooseTransition: (seed, paragraphIndex, previousKind) => chooseWithoutRepeat(
        SONNET_TRANSITION_KINDS,
        `${seed}:${paragraphIndex}:transition`,
        previousKind as SonnetTransitionKind | null,
    ),

    describeShot: (shot, lines) => {
        const real = shot.lineIndices.filter(index => index >= 0 && lines[index]);
        const span: ShotSpan = {
            id: shot.id,
            startTime: shot.startTime,
            endTime: shot.endTime,
            lyricEndTime: Math.min(shot.endTime, Math.max(
                shot.startTime,
                ...real.flatMap(index => segmentsOf(lines[index]).map(segment => segment.endTime)),
            )),
            isBridge: false,
            slices: real.map(index => ({ lineIndex: index, startOffset: 0, endOffset: lines[index].line.fullText.length })),
        };
        return {
            id: shot.id,
            kind: shot.kind,
            span,
            components: { typography: shot.typography ?? shot.kind, accent: shot.accent ?? 'standard' },
        };
    },

    componentSlots,

    applyComponents: (shot, components) => {
        let next = shot;
        const typography = components.typography as SonnetShotKind | undefined;
        if (typography) {
            const { typography: _previous, ...rest } = next;
            next = typography === rest.kind ? rest : { ...rest, typography };
        }
        const accent = components.accent as SonnetAccent | 'standard' | undefined;
        if (accent) {
            const { accent: _previous, ...rest } = next;
            next = accent === 'standard' ? rest : { ...rest, accent };
        }
        return next;
    },

    textRegion: kind => (SONNET_SHOT_KINDS as readonly string[]).includes(kind) ? textRegionOf(kind as SonnetShotKind) : null,

    typographyExports: SONNET_SHOT_KINDS.map(kind => ({ id: kind, label: TYPOGRAPHY_LABELS[kind], kind })),

    textOnlyTuning: tuning => ({ ...tuning, showOnlyText: true, enableTransitions: false }),

    hideText: shot => ({ ...shot, textHidden: true }),

    // tempera 的半句切片等 → sonnet：为镜头造「伪行」，原行只保留切片范围内的片段，给一个负的行序号，
    // sonnet 就只排这半句。
    fromSpan: (span, kind, context) => {
        if (span.isBridge || span.slices.length === 0) return null;
        const pseudoLines: SonnetCompiledLine[] = span.slices.map((slice, index) => {
            const line = context.songLines[slice.lineIndex];
            return {
                sourceIndex: pseudoIndex(context.paragraphIndex, context.shotIndex, index),
                line: line.line,
                renderEndTime: line.renderEndTime,
                segments: segmentsOf(line).filter(segment => segment.endOffset > slice.startOffset && segment.startOffset < slice.endOffset),
            };
        }).filter(line => line.segments.length > 0);
        if (pseudoLines.length === 0) return null;
        const shotKind = kind as SonnetShotKind;
        const shot: SonnetShot = {
            id: span.id,
            kind: shotKind,
            startTime: span.startTime,
            endTime: span.endTime,
            lineIndices: pseudoLines.map(line => line.sourceIndex),
            cues: buildCues(pseudoLines),
            camera: buildSonnetShotCamera(shotKind, `${context.seed}:${context.paragraphIndex}:${context.shotIndex}:camera`),
        };
        const extra: SonnetShotExtra = { lines: pseudoLines };
        return { shot, extra };
    },

    toNativeParagraph: (program, paragraph, options = {}) => {
        const shots = (options.shots ?? paragraph.shots).filter(shot => shot.native.pack === SONNET_PACK_ID);
        const transition = options.transitionOut !== undefined ? options.transitionOut : paragraph.transitionOut;
        const def = transition ? getTransition(transition.id) : undefined;
        const id = `sonnet-p${paragraph.index}${options.idSuffix ?? ''}`;
        const data: SonnetParagraph = {
            id,
            kind: paragraph.kind,
            // 原生包把用户分段与无词停顿边界都按时间空隙处理。
            boundary: paragraph.boundary === 'manual' || paragraph.boundary === 'lyric-gap' ? 'time-gap' : paragraph.boundary,
            startTime: options.startTime ?? paragraph.startTime,
            endTime: options.endTime ?? paragraph.endTime,
            lines: [
                ...paragraph.lineIndices.map(index => compiledLine(program.lines[index])),
                // 从另一个包的半句切片转来的镜头带着自己的伪行。
                ...shots.flatMap(shot => (shot.native.extra as SonnetShotExtra | undefined)?.lines ?? []),
            ],
            shots: shots.map(shot => shot.native.shot as SonnetShot),
            transitionOut: transition && def?.pack === SONNET_PACK_ID
                ? { kind: def.kind as SonnetTransitionKind, startTime: transition.startTime, endTime: transition.endTime }
                : null,
        };
        return { id, data };
    },

    createAdapter: createSonnetAdapter,
};

export default sonnetPack;
