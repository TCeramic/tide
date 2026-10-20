// src/packs/hanabi/pack.ts
// 花火（hanabi）风格包：日式歌词 PV——每句歌词带着自己的字底色块出场，烟花一样的 MG 装饰件沿着文字开花，
// 镜头之间整个世界持续向上升。设计见 docs/HANABI.md。编译在 program.ts，画面在 scene.ts。
import type { Line } from '@/core/types';
import { completeFrame } from '@/kernel/transitions';
import { getTransition } from '@/packs/registry';
import type { CompiledShot, ComponentSlotDef, FamilyDef, ShotSpan, StyleDef, StylePack, TextRegion, TransitionDef } from '@/packs/contract';
import { createHanabiAdapter } from './adapter';
import {
    BLOCK_LABELS,
    BURST_KINDS,
    BURST_LABELS,
    ENTER_LABELS,
    HANABI_FAMILY_DESCRIPTIONS,
    HANABI_FAMILY_LABELS,
    HANABI_PROFILES,
    hasProfile,
    profileOf,
} from './catalog';
import {
    advanceChain,
    castShot,
    DEFAULT_HANABI_PARAMS,
    planShots,
    segmentHanabiLine,
    shotText,
    type HanabiChain,
    type HanabiParagraph,
    type HanabiParams,
    type HanabiShot,
} from './program';
import { describeHanabiSlots, hanabiStyleNote } from './styleNotes';
import { DEFAULT_HANABI_TUNING, HANABI_PACK_ID, type BlockStyle, type BurstKind, type EnterFx, type HanabiTuning } from './types';

export { HANABI_PACK_ID };

const families: FamilyDef[] = Object.entries(HANABI_FAMILY_LABELS)
    .filter(([id]) => HANABI_PROFILES.some(profile => profile.family === id))
    .map(([id, label]) => ({ id, pack: HANABI_PACK_ID, label, description: HANABI_FAMILY_DESCRIPTIONS[id] }));

const styles: StyleDef[] = HANABI_PROFILES.map(profile => ({
    id: `${HANABI_PACK_ID}/${profile.kind}`,
    pack: HANABI_PACK_ID,
    kind: profile.kind,
    family: profile.family,
    mood: profile.mood,
    ...hanabiStyleNote(profile),
}));

const smooth = (value: number) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};

const TRANSITION_KINDS = ['ascend', 'flash', 'bloom'] as const;
type HanabiTransitionKind = typeof TRANSITION_KINDS[number];

/**
 * 段落转场的内核帧（y 是画面高度的比例）。
 * 上升：摄影机继续往上走——旧画面向下滑走并模糊，新画面从上方落进来；闪白：短促的放大 + 模糊峰值落在边界；
 * 开花：旧画面放大淡出（像一朵花散开），新画面从略小处淡入。
 */
const resolveHanabiTransition = (kind: HanabiTransitionKind, phase: 'enter' | 'exit', progress: number) => {
    const p = Math.min(1, Math.max(0, progress));
    if (kind === 'ascend') {
        if (phase === 'exit') {
            const e = p * p;
            return completeFrame({ y: 0.32 * e, blur: 10 * e, alpha: 1 - 0.7 * smooth((p - 0.5) / 0.5) });
        }
        const k = (1 - p) ** 2;
        return completeFrame({ y: -0.26 * k, blur: 10 * k, alpha: 1 - 0.7 * k });
    }
    if (kind === 'flash') {
        const near = phase === 'exit' ? smooth(p) : 1 - smooth(p);
        return completeFrame({ scale: 1 + 0.05 * near, blur: 9 * near * near, alpha: 1 - 0.55 * near * near });
    }
    if (phase === 'exit') {
        const e = smooth(p);
        return completeFrame({ scale: 1 + 0.18 * e, blur: 5 * e, alpha: 1 - e });
    }
    const k = 1 - smooth(p);
    return completeFrame({ scale: 1 - 0.08 * k, blur: 4 * k, alpha: 1 - k });
};

const transitions: TransitionDef[] = TRANSITION_KINDS.map(kind => ({
    id: `${HANABI_PACK_ID}/${kind}`,
    pack: HANABI_PACK_ID,
    kind,
    label: { ascend: '上升', flash: '闪白', bloom: '开花' }[kind],
    preRoll: false,
    duration: gap => (kind === 'flash'
        ? Math.min(0.5, Math.max(0.28, gap > 0 ? gap * 0.4 : 0.35))
        : Math.min(1.1, Math.max(0.5, gap > 0 ? gap * 0.6 : 0.8))),
    enterClamp: kind === 'flash' ? [0.2, 0.45] : [0.4, 0.9],
    resolveFrame: (phase, progress) => resolveHanabiTransition(kind, phase, progress),
}));

/** 借给别的包的排版：色块各一种（band / tile / slant / double / pill / split / ticket / marker / outline / circle / stair），加上竖排、拱弧与故障。 */
const TYPOGRAPHY_EXPORTS = [
    'botan-band', 'botan-tile', 'obi-slant', 'uchiage-double', 'uchiage-botan', 'botan-split', 'obi-ticket',
    'obi-marker', 'senko-scramble', 'botan-circle', 'obi-stair', 'yanagi-shidare', 'kiku-halo', 'senko-glitch',
] as const;

const typographyLabel = (kind: string) => {
    const { text } = profileOf(kind);
    return `${BLOCK_LABELS[text.block]} · ${ENTER_LABELS[text.enter]}${text.layout === 'vertical' ? '（竖排）' : text.layout === 'arc' ? '（拱弧）' : ''}`;
};

const componentSlots: ComponentSlotDef[] = describeHanabiSlots([
    { id: 'typography', label: '排版', options: HANABI_PROFILES.map(profile => ({ id: profile.kind, label: `${profile.label}：${typographyLabel(profile.kind)}` })) },
    { id: 'block', label: '字底色块', options: (Object.keys(BLOCK_LABELS) as BlockStyle[]).map(id => ({ id, label: BLOCK_LABELS[id] })) },
    { id: 'enter', label: '入场', options: (Object.keys(ENTER_LABELS) as EnterFx[]).map(id => ({ id, label: ENTER_LABELS[id] })) },
    { id: 'burst', label: '主烟花', options: BURST_KINDS.map(id => ({ id, label: BURST_LABELS[id] })) },
]);

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => (
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
);

const COLOR_MODES: HanabiTuning['colorMode'][] = ['theme', 'vivid', 'mixed'];

const normalizeTuning = (raw: unknown): HanabiTuning => {
    const input = { ...DEFAULT_HANABI_TUNING, ...(raw as Partial<HanabiTuning> | undefined) };
    const d = DEFAULT_HANABI_TUNING;
    return {
        colorMode: COLOR_MODES.includes(input.colorMode) ? input.colorMode : d.colorMode,
        sparkAmount: clampNumber(input.sparkAmount, d.sparkAmount, 0, 2),
        ornamentAmount: clampNumber(input.ornamentAmount, d.ornamentAmount, 0, 2),
        textMotion: clampNumber(input.textMotion, d.textMotion, 0, 2),
        blockOpacity: clampNumber(input.blockOpacity, d.blockOpacity, 0, 1),
        riseSpeed: clampNumber(input.riseSpeed, d.riseSpeed, 0, 2),
        ambient: clampNumber(input.ambient, d.ambient, 0, 2),
        glow: clampNumber(input.glow, d.glow, 0, 2),
        launches: input.launches !== false,
        overlayFrame: input.overlayFrame !== false,
        // 只画字是内核借排版时临时套上的，不存进工程。
        textOnly: false,
    };
};

const normalizeParams = (raw: unknown): HanabiParams => {
    const input = { ...DEFAULT_HANABI_PARAMS, ...(raw as Partial<HanabiParams> | undefined) };
    const d = DEFAULT_HANABI_PARAMS;
    return {
        bridgeGap: clampNumber(input.bridgeGap, d.bridgeGap, 1, 12),
        maxChars: Math.round(clampNumber(input.maxChars, d.maxChars, 6, 40)),
        maxLineSeconds: clampNumber(input.maxLineSeconds, d.maxLineSeconds, 2, 15),
    };
};

const shotId = (paragraphIndex: number, shotIndex: number) => `p${paragraphIndex}-hb${shotIndex}`;

const regionOf = (kind: string): TextRegion => {
    const { region, text } = profileOf(kind);
    const align = text.layout === 'left' ? 'left' : text.layout === 'right' ? 'right' : 'center';
    return { cx: region.cx, cy: region.cy, w: region.w, h: region.h, rotation: text.tilt, align };
};

export const hanabiPack: StylePack<HanabiTuning, HanabiParams, HanabiChain, HanabiShot, HanabiParagraph> = {
    id: HANABI_PACK_ID,
    order: 40,
    label: '花火 hanabi',
    shortLabel: '花火',
    color: '#ff7a8a',
    description: '日式歌词 PV：每句歌词带着高饱和的字底色块逐字弹出，烟花一样的 MG 装饰件沿着文字开花、闪烁、飘落，镜头之间整个画面跟着升空的烟花持续向上升。明快、热闹、有节庆感，适合副歌、高能段落与夏日祭典感的歌。',
    version: 1,
    families,
    styles,
    transitions,
    shotBoundaryTransition: `${HANABI_PACK_ID}/flash`,
    tuning: { defaults: DEFAULT_HANABI_TUNING, normalize: normalizeTuning },
    params: { defaults: DEFAULT_HANABI_PARAMS, normalize: normalizeParams },

    segmentLine: (line: Line) => segmentHanabiLine(line),

    createChain: () => ({ recent: [], family: null }),

    compileParagraph: (context, chain) => {
        const planned = planShots(context.lines, context.lines[0]?.line.startTime ?? context.endTime, context.endTime, context.params);
        const lastLine = context.lines.at(-1);
        let bridgeCount = 0;
        return planned.map((plan, shotIndex): CompiledShot<HanabiShot> => {
            const bridge = plan.isBridge;
            const slot = plan.slot ?? `b${bridgeCount++}`;
            const anchorLine = bridge ? lastLine?.sourceIndex ?? 0 : plan.slices[0]!.lineIndex;
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
                    slices: plan.slices,
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

    chooseTransition: (seed, paragraphIndex, previousKind) => {
        const choices = TRANSITION_KINDS.filter(kind => kind !== previousKind);
        let hash = 0;
        for (const char of `${seed}:${paragraphIndex}:hanabi-transition`) hash = (hash * 31 + char.charCodeAt(0)) | 0;
        return choices[Math.abs(hash) % choices.length]!;
    },

    describeShot: (shot, lines) => {
        const profile = profileOf(shot.kind);
        const text = shotText(shot);
        const span: ShotSpan = {
            id: shot.id,
            startTime: shot.startTime,
            endTime: shot.endTime,
            lyricEndTime: shot.lyricEndTime,
            isBridge: shot.isBridge,
            slices: shot.slices.filter(slice => lines[slice.lineIndex]).map(slice => ({ ...slice })),
        };
        return {
            id: shot.id,
            kind: shot.kind,
            span,
            components: {
                typography: shot.typography ?? shot.kind,
                block: text.block,
                enter: text.enter,
                burst: shot.burst ?? profile.burst?.kind ?? 'kiku',
            },
        };
    },

    componentSlots,

    // 与预设默认相同的不写进原生结构（换预设时跟着预设走）。
    applyComponents: (shot, components) => {
        const profile = profileOf(shot.kind);
        const next: HanabiShot = { ...shot };
        const typography = components.typography;
        if (typography && hasProfile(typography)) {
            if (typography === shot.kind) delete next.typography;
            else next.typography = typography;
        }
        // 色块与入场的默认值跟着排版走（先套排版再比较）。
        const text = profileOf(next.typography ?? next.kind).text;
        const block = components.block as BlockStyle | undefined;
        if (block) {
            if (block === text.block) delete next.block;
            else next.block = block;
        }
        const enter = components.enter as EnterFx | undefined;
        if (enter) {
            if (enter === text.enter) delete next.enter;
            else next.enter = enter;
        }
        const burst = components.burst as BurstKind | undefined;
        if (burst) {
            if (burst === profile.burst?.kind) delete next.burst;
            else next.burst = burst;
        }
        return next;
    },

    textRegion: kind => (hasProfile(kind) ? regionOf(kind) : null),

    // 跨包借排版：花火的排版（排法 + 字底色块 + 逐字动画）跟着预设走，挑覆盖全部色块、竖排、拱弧与故障的 14 个预设导出。
    typographyExports: TYPOGRAPHY_EXPORTS.map(kind => ({ id: kind, label: typographyLabel(kind), kind })),

    textOnlyTuning: tuning => ({ ...tuning, textOnly: true }),

    hideText: shot => ({ ...shot, textHidden: true }),

    // 别的包的镜头 → 花火：切片原样保留（跨行的拼成一行排），间奏也能转（放一串烟花）。
    fromSpan: (span, kind) => ({
        shot: {
            id: span.id,
            kind: hasProfile(kind) ? kind : HANABI_PROFILES[0]!.kind,
            slices: span.isBridge ? [] : span.slices.map(slice => ({ ...slice })),
            startTime: span.startTime,
            endTime: span.endTime,
            lyricEndTime: span.lyricEndTime,
            isBridge: span.isBridge || span.slices.length === 0,
        },
    }),

    toNativeParagraph: (program, paragraph, options = {}) => {
        const shots = (options.shots ?? paragraph.shots).filter(shot => shot.native.pack === HANABI_PACK_ID);
        const native = shots.map(shot => shot.native.shot as HanabiShot);
        const transition = options.transitionOut !== undefined ? options.transitionOut : paragraph.transitionOut;
        const def = transition ? getTransition(transition.id) : undefined;
        const id = `hanabi-p${paragraph.index}${options.idSuffix ?? ''}`;
        const lineIndices = [...new Set([...paragraph.lineIndices, ...native.flatMap(shot => shot.slices.map(slice => slice.lineIndex))])]
            .filter(index => program.lines[index])
            .sort((a, b) => a - b);
        const data: HanabiParagraph = {
            id,
            startTime: options.startTime ?? paragraph.startTime,
            endTime: options.endTime ?? paragraph.endTime,
            lineIndices,
            lines: lineIndices.map(index => program.lines[index]!.line),
            shots: native,
            transitionOut: transition && def?.pack === HANABI_PACK_ID
                ? { kind: def.kind, startTime: transition.startTime, endTime: transition.endTime }
                : transition
                    ? { kind: transition.id, startTime: transition.startTime, endTime: transition.endTime }
                    : null,
        };
        return { id, data };
    },

    createAdapter: createHanabiAdapter,
};

export default hanabiPack;
