// src/packs/tempera/pack.ts
// 凝彩（tempera）风格包：网点图形 MG。切块、选构图、镜头关键帧与装饰都在 temperaProgram.ts
// （folia 原版逻辑，加了编排钩子）；这里把它们接到 StylePack 契约上。
import type { Line } from '@/core/types';
import { getTransition } from '@/packs/registry';
import type { CompiledShot, ComponentSlotDef, FamilyDef, ShotSpan, StyleDef, StylePack, TransitionDef } from '@/packs/contract';
import { fromTemperaFrame } from '@/kernel/transitions';
import type { UnifiedLine } from '@/compiler/types';
import { createTemperaAdapter } from './adapter';
import {
    buildBridgeShots,
    buildCameraKeys,
    buildDecorSpec,
    buildShots,
    buildTemperaSegments,
    isRenderableSegment,
    resolveFlowAngle,
    type TemperaCastHooks,
} from './temperaProgram';
import { chooseWithoutRepeat, hashTemperaSeed } from './temperaRandom';
import { resolveTemperaShotProfile, TEMPERA_SHOT_PROFILES } from './temperaShotProfiles';
import { resolveTemperaTransitionEffectFrame } from './temperaTransitions';
import { DEFAULT_TEMPERA_TUNING, type TemperaTuning } from './temperaTuning';
import {
    TEMPERA_DECOR_MOTIFS,
    TEMPERA_SHOT_KINDS,
    TEMPERA_TRANSITION_KINDS,
    TEMPERA_TYPOGRAPHY,
    type TemperaTypography,
    type TemperaCompiledLine,
    type TemperaDecorMotif,
    type TemperaParagraph,
    type TemperaSegment,
    type TemperaShot,
    type TemperaShotKind,
    type TemperaTransitionKind,
} from './types';
import {
    TEMPERA_ACCENT_NOTES,
    TEMPERA_ACCENT_SLOT_DESCRIPTION,
    TEMPERA_FAMILY_DESCRIPTIONS,
    TEMPERA_STYLE_NOTES,
    TEMPERA_TYPOGRAPHY_NOTES,
    TEMPERA_TYPOGRAPHY_SLOT_DESCRIPTION,
    type TemperaFamilyId,
} from './temperaStyleNotes';

export const TEMPERA_PACK_ID = 'tempera';

export interface TemperaParams {
    /** 默认切块：每个 shot 放 minWords..maxWords 个词，或到 maxSeconds 为止。 */
    chunkMinWords: number;
    chunkMaxWords: number;
    chunkMaxSeconds: number;
    /** 段间空隙 ≥ bridgeMinGap 时插入无歌词的 bridge shot，每个不超过 bridgeMaxLength 秒，最多 bridgeMaxShots 个。 */
    bridgeMinGap: number;
    bridgeMaxLength: number;
    bridgeMaxShots: number;
}

export const DEFAULT_TEMPERA_PARAMS: TemperaParams = {
    chunkMinWords: 2,
    chunkMaxWords: 4,
    chunkMaxSeconds: 2.2,
    bridgeMinGap: 1.2,
    bridgeMaxLength: 5,
    bridgeMaxShots: 3,
};

interface TemperaChain {
    shot: TemperaShotKind | null;
    motif: TemperaDecorMotif | null;
    flow: number | null;
}

// 族按 TEMPERA_SHOT_KINDS 里的分组顺序与数量划分（见 types.ts 注释）。
const FAMILY_SPANS: Array<[TemperaFamilyId, string, number]> = [
    ['split', '分割', 13], ['band', '色带', 9], ['frame', '框窗', 10], ['poster', '海报', 10],
    ['sparse', '稀疏', 8], ['cinema', '遮幅', 7], ['charm', '圆滑', 9], ['aperture', '镂空', 10],
    ['signal', '仪表', 10], ['corridor', '通道', 10], ['monolith', '巨构', 10], ['terrain', '地形', 10],
    ['monogatari', '物语', 5],
];

const families: FamilyDef[] = FAMILY_SPANS.map(([id, label]) => ({
    id,
    pack: TEMPERA_PACK_ID,
    label,
    description: TEMPERA_FAMILY_DESCRIPTIONS[id],
}));

const styles: StyleDef[] = (() => {
    const result: StyleDef[] = [];
    let cursor = 0;
    for (const [family, , count] of FAMILY_SPANS) {
        TEMPERA_SHOT_KINDS.slice(cursor, cursor + count).forEach(kind => result.push({
            id: `${TEMPERA_PACK_ID}/${kind}`,
            pack: TEMPERA_PACK_ID,
            kind,
            family,
            mood: TEMPERA_SHOT_PROFILES[kind].mood,
            // 中文名与画面描述见 temperaStyleNotes.ts（给 AI 编排与 agent 选风格用）。
            label: TEMPERA_STYLE_NOTES[kind].label,
            description: TEMPERA_STYLE_NOTES[kind].description,
            keywords: [...TEMPERA_STYLE_NOTES[kind].keywords],
        }));
        cursor += count;
    }
    if (cursor !== TEMPERA_SHOT_KINDS.length) throw new Error(`tempera family spans cover ${cursor} of ${TEMPERA_SHOT_KINDS.length} kinds`);
    return result;
})();

const TRANSITION_LABELS: Record<TemperaTransitionKind, string> = {
    'block-wipe': '色块擦除',
    'camera-pan': '镜头平移',
    'shape-carry': '形状接力',
};

const transitions: TransitionDef[] = TEMPERA_TRANSITION_KINDS.map(kind => ({
    id: `${TEMPERA_PACK_ID}/${kind}`,
    pack: TEMPERA_PACK_ID,
    kind,
    label: TRANSITION_LABELS[kind],
    // 平移类需要另一头有东西；block-wipe 的进入阶段是揭开遮罩，必须在边界之后。
    preRoll: kind !== 'block-wipe',
    duration: gap => Math.min(1, Math.max(0.35, Math.max(gap, 0) + 0.3)),
    enterClamp: [0.35, 1],
    resolveFrame: (phase, progress, context) => fromTemperaFrame(resolveTemperaTransitionEffectFrame(kind, phase, progress, context.flowAngle)),
}));

// 路线 E：构图就是风格本身；排版与点缀可以逐镜头替换。
const TYPOGRAPHY_LABELS: Record<TemperaTypography, string> = {
    collage: '拼贴（默认）',
    uniform: '统一字号',
    stack: '竖排堆叠',
    stamp: '盖章',
};
const ACCENT_LABELS: Record<TemperaDecorMotif | 'none', string> = {
    diamonds: '同心菱形',
    'hatch-twin': '双网格',
    'band-cross': '十字排',
    'poster-diamond': '出血菱形',
    doodle: '涂鸦',
    none: '无点缀',
};

const componentSlots: ComponentSlotDef[] = [
    {
        id: 'typography',
        label: '排版',
        description: TEMPERA_TYPOGRAPHY_SLOT_DESCRIPTION,
        options: TEMPERA_TYPOGRAPHY.map(id => ({ id, label: TYPOGRAPHY_LABELS[id], description: TEMPERA_TYPOGRAPHY_NOTES[id] })),
    },
    {
        id: 'accent',
        label: '点缀',
        description: TEMPERA_ACCENT_SLOT_DESCRIPTION,
        options: [...TEMPERA_DECOR_MOTIFS, 'none' as const].map(id => ({ id, label: ACCENT_LABELS[id], description: TEMPERA_ACCENT_NOTES[id] })),
    },
];

const segmentsOf = (line: UnifiedLine) => line.segments[TEMPERA_PACK_ID] as TemperaSegment[];

const compiledLine = (line: UnifiedLine): TemperaCompiledLine => ({
    sourceIndex: line.sourceIndex,
    line: line.line,
    renderEndTime: line.renderEndTime,
    segments: segmentsOf(line),
});

type Mood = 'quiet' | 'neutral' | 'loud';
const moodsForEnergy = (energy: number): Mood[] => (
    energy < 0.33 ? ['quiet'] : energy < 0.66 ? ['quiet', 'neutral'] : ['neutral', 'loud']
);

const normalizeTuning = (raw: unknown): TemperaTuning => {
    const tuning = { ...DEFAULT_TEMPERA_TUNING, ...(raw as Partial<TemperaTuning> | undefined) };
    const saturation = Number(tuning.colorSaturation);
    const colorMode = (['duo', 'mono', 'gradient', 'colorful'] as const).includes(tuning.colorMode)
        ? tuning.colorMode : DEFAULT_TEMPERA_TUNING.colorMode;
    return { ...tuning, colorMode, colorSaturation: Number.isFinite(saturation) ? Math.min(3, Math.max(0, saturation)) : DEFAULT_TEMPERA_TUNING.colorSaturation };
};
const normalizeParams = (raw: unknown): TemperaParams => {
    const params = { ...DEFAULT_TEMPERA_PARAMS, ...(raw as Partial<TemperaParams> | undefined) };
    return { ...params, chunkMaxWords: Math.max(params.chunkMinWords, params.chunkMaxWords) };
};

const withAnchors = (shots: TemperaShot[], lastLineIndex: number): Array<CompiledShot<TemperaShot>> => {
    const ordinals = new Map<number, number>();
    return shots.map(shot => {
        if (shot.isBridge) return { native: shot, lineIndex: lastLineIndex, slot: `b${shot.id.split('-b')[1] ?? 0}` };
        const lineIndex = shot.slices[0]?.lineIndex ?? lastLineIndex;
        const ordinal = ordinals.get(lineIndex) ?? 0;
        ordinals.set(lineIndex, ordinal + 1);
        return { native: shot, lineIndex, slot: `s${ordinal}` };
    });
};

export const temperaPack: StylePack<TemperaTuning, TemperaParams, TemperaChain, TemperaShot, TemperaParagraph> = {
    id: TEMPERA_PACK_ID,
    order: 10,
    label: '凝彩 tempera',
    shortLabel: '凝彩',
    color: '#f59e0b',
    description: '网点图形（screentone）MG：大面积色块、镂空、巨构、遮幅等几何构图，文字按底色动态反色，镜头沿同一方向接力交接，读作一条纵向长镜头。冲击力强，适合副歌、上扬与间奏。',
    version: 1,
    families,
    styles,
    transitions,
    shotBoundaryTransition: `${TEMPERA_PACK_ID}/shape-carry`,
    tuning: { defaults: DEFAULT_TEMPERA_TUNING, normalize: normalizeTuning },
    params: { defaults: DEFAULT_TEMPERA_PARAMS, normalize: normalizeParams },

    segmentLine: (line: Line) => buildTemperaSegments(line),

    createChain: () => ({ shot: null, motif: null, flow: null }),

    compileParagraph: (context, chain) => {
        const { cast, params } = context;
        const moods = cast.energy === null ? null : moodsForEnergy(cast.energy);
        const hooks: TemperaCastHooks = {
            candidates: cast.filterCandidates
                ? defaults => cast.filterCandidates!(defaults) as readonly TemperaShotKind[]
                : undefined,
            moods: moods === null ? undefined : (_defaults, { isBridge }) => {
                if (!isBridge) return moods;
                // 间奏从来不是全曲最喧哗的地方。
                const calm = moods.filter(mood => mood !== 'loud');
                return calm.length > 0 ? calm : ['neutral'];
            },
            forceKind: cast.forceKind
                ? slot => cast.forceKind!(slot) as TemperaShotKind | null
                : undefined,
            chunk: { minWords: params.chunkMinWords, maxWords: params.chunkMaxWords, maxSeconds: params.chunkMaxSeconds },
            bridge: { minGap: params.bridgeMinGap, maxLength: params.bridgeMaxLength, maxShots: params.bridgeMaxShots },
        };
        const lines = context.lines.map(compiledLine);
        const lyricShots = buildShots(
            lines,
            context.songLines.map(compiledLine),
            context.kind,
            context.paragraphIndex,
            context.seed,
            chain.shot,
            chain.motif,
            chain.flow,
            context.tuning.wholeLineLyrics,
            hooks,
        );
        chain.shot = lyricShots.at(-1)?.kind ?? chain.shot;
        chain.motif = lyricShots.at(-1)?.decor.motif ?? chain.motif;
        chain.flow = lyricShots.at(-1)?.flowAngle ?? chain.flow;
        const bridgeShots = context.nextStartTime !== null
            ? buildBridgeShots(
                context.kind,
                context.paragraphIndex,
                context.seed,
                lines.map(item => item.line.fullText).join(''),
                context.endTime,
                context.nextStartTime,
                chain.shot,
                chain.motif,
                chain.flow,
                hooks,
            )
            : [];
        const all = [...lyricShots, ...bridgeShots];
        chain.shot = all.at(-1)?.kind ?? chain.shot;
        chain.motif = all.at(-1)?.decor.motif ?? chain.motif;
        chain.flow = all.at(-1)?.flowAngle ?? chain.flow;
        return withAnchors(all, context.lines.at(-1)!.sourceIndex);
    },

    chooseTransition: (seed, paragraphIndex, previousKind) => chooseWithoutRepeat(
        TEMPERA_TRANSITION_KINDS,
        `${seed}:${paragraphIndex}:transition`,
        previousKind as TemperaTransitionKind | null,
    ),

    describeShot: (shot, lines) => {
        const span: ShotSpan = {
            id: shot.id,
            startTime: shot.startTime,
            endTime: shot.endTime,
            lyricEndTime: shot.lyricEndTime,
            isBridge: shot.isBridge,
            slices: shot.slices.map(slice => {
                const segments = segmentsOf(lines[slice.lineIndex]);
                return {
                    lineIndex: slice.lineIndex,
                    startOffset: segments[slice.segmentStart]?.startOffset ?? 0,
                    endOffset: segments[slice.segmentEnd - 1]?.endOffset ?? 0,
                };
            }),
        };
        return {
            id: shot.id,
            kind: shot.kind,
            span,
            components: { typography: shot.typography ?? 'collage', accent: shot.decor.hidden ? 'none' : shot.decor.motif },
        };
    },

    componentSlots,

    applyComponents: (shot, components) => {
        let next = shot;
        const typography = components.typography as TemperaTypography | undefined;
        // collage 是默认值：不写进原生结构，保持与没设置过时逐字段相同。
        if (typography) {
            const { typography: _previous, ...rest } = next;
            next = typography === 'collage' ? rest : { ...rest, typography };
        }
        const accent = components.accent;
        if (accent) {
            const { hidden: _hidden, ...decor } = next.decor;
            next = {
                ...next,
                decor: accent === 'none' ? { ...decor, hidden: true } : { ...decor, motif: accent as TemperaDecorMotif },
            };
        }
        return next;
    },

    textRegion: kind => {
        const { region } = resolveTemperaShotProfile(kind as TemperaShotKind);
        return { cx: region.cx, cy: region.cy, w: region.w, h: region.h, rotation: region.rotation, align: region.align };
    },

    typographyExports: TEMPERA_TYPOGRAPHY.map(id => ({ id, label: TYPOGRAPHY_LABELS[id], kind: 'duo-split' })),

    textOnlyTuning: tuning => ({
        ...tuning,
        showBlocks: false,
        showDecor: false,
        showCornerMarks: false,
        textInversion: false,
        layerImages: [],
        enableTransitions: false,
    }),

    hideText: shot => ({ ...shot, textHidden: true }),

    applyPreRoll: (shot, startTime) => ({ ...shot, startTime }),

    // sonnet 等整句镜头 → tempera：每个切片按文字偏移找回 tempera 的片段范围，
    // 镜头关键帧、flow、装饰按 tempera 的规则补齐并接上 flow 链。
    fromSpan: (span, kind, context, chain) => {
        if (span.isBridge) return null;
        const slices: TemperaShot['slices'] = [];
        let lyricEndTime = span.startTime + 0.2;
        for (const slice of span.slices) {
            const line = context.songLines[slice.lineIndex];
            if (!line) continue;
            const usable = segmentsOf(line)
                .map((segment, index) => ({ segment, index }))
                .filter(entry => isRenderableSegment(entry.segment)
                    && entry.segment.endOffset > slice.startOffset
                    && entry.segment.startOffset < slice.endOffset);
            if (usable.length === 0) continue;
            slices.push({ lineIndex: slice.lineIndex, segmentStart: usable[0].index, segmentEnd: usable.at(-1)!.index + 1 });
            lyricEndTime = Math.max(lyricEndTime, usable.at(-1)!.segment.endTime);
        }
        if (slices.length === 0) return null;
        const key = `${context.seed}:${context.paragraphIndex}:${context.shotIndex}`;
        const cameraSeed = hashTemperaSeed(`${key}:camera`);
        const flowAngle = resolveFlowAngle(chain.flow, cameraSeed);
        const shotKind = kind as TemperaShotKind;
        const { start, end } = buildCameraKeys(shotKind, cameraSeed, flowAngle);
        const covered = new Set(span.slices.map(slice => slice.lineIndex));
        const others = context.lines.filter(line => !covered.has(line.sourceIndex));
        const decor = buildDecorSpec(
            context.kind,
            shotKind,
            `${key}:decor`,
            others.map(line => line.line.fullText).join(''),
            others.flatMap(line => segmentsOf(line).filter(segment => segment.isWordLike).map(segment => segment.text)),
            chain.motif,
        );
        chain.flow = flowAngle;
        chain.motif = decor.motif;
        chain.shot = shotKind;
        const shot: TemperaShot = {
            id: span.id,
            kind: shotKind,
            startTime: span.startTime,
            endTime: span.endTime,
            lyricEndTime: Math.min(lyricEndTime, span.endTime),
            slices,
            isBridge: false,
            camera: start,
            cameraEnd: end,
            flowAngle,
            decor,
        };
        return { shot };
    },

    toNativeParagraph: (program, paragraph, options = {}) => {
        const shots = (options.shots ?? paragraph.shots).filter(shot => shot.native.pack === TEMPERA_PACK_ID);
        const transition = options.transitionOut !== undefined ? options.transitionOut : paragraph.transitionOut;
        const def = transition ? getTransition(transition.id) : undefined;
        const id = `tempera-p${paragraph.index}${options.idSuffix ?? ''}`;
        const data: TemperaParagraph = {
            id,
            kind: paragraph.kind,
            // 原生包把用户分段与无词停顿边界都按时间空隙处理。
            boundary: paragraph.boundary === 'manual' || paragraph.boundary === 'lyric-gap' ? 'time-gap' : paragraph.boundary,
            startTime: options.startTime ?? paragraph.startTime,
            endTime: options.endTime ?? paragraph.endTime,
            lines: paragraph.lineIndices.map(index => compiledLine(program.lines[index])),
            shots: shots.map(shot => shot.native.shot as TemperaShot),
            // 原生结构里只放本包的转场；别的包的转场由内核处理。
            transitionOut: transition && def?.pack === TEMPERA_PACK_ID
                ? { kind: def.kind as TemperaTransitionKind, startTime: transition.startTime, endTime: transition.endTime }
                : null,
        };
        return { id, data };
    },

    createAdapter: createTemperaAdapter,
};

export default temperaPack;
