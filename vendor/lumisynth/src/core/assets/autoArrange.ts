// src/core/assets/autoArrange.ts
// 自动编排素材图片：以镜头为单位轮流放图——镜头切换时图跟着换；立绘（竖长的图）在横屏上左右交替、
// 从自己那一侧滑入，横图放中间；按变化度在几种构图（远近、偏移、倾斜）间抽签，位置大小带一点抖动。
// 片段挂在镜头上（改编排后跟着对应的镜头走），默认在场景之上、歌词之下，贴在场景上。
// 生成的片段 id 以 AUTO_CLIP_PREFIX 开头：重新编排只替换这些，不动用户自己摆的。纯函数，同样的输入同样的结果。
import type { LumiProgram, LumiShot, ParagraphKind } from '@/compiler/types';
import { createRng, rng } from '@/core/rng';
import { DEFAULT_CLIP_LOOK, normalizeClipEffect, normalizeClipMotion, type AssetClip, type AssetSlot, type ClipAnimationType, type ClipEffectType, type ClipMotionType, type FollowMode } from './clips';

export const AUTO_CLIP_PREFIX = 'auto-';
export const isAutoClip = (clip: Pick<AssetClip, 'id'>) => clip.id.startsWith(AUTO_CLIP_PREFIX);

export type ArrangeCoverage = 'all' | 'highlights';

export interface ArrangeOptions {
    slot: AssetSlot;
    follow: FollowMode;
    effect: ClipEffectType;
    effectColor: string;
    /** 持续运动（绘光这类几乎没有运镜的场景里，图不至于完全静止）。 */
    motion: ClipMotionType;
    /** all：每个镜头都放；highlights：只在副歌、上扬与间奏里的镜头。 */
    coverage: ArrangeCoverage;
    /**
     * 每个（符合范围的）镜头放图的概率 0..1。按工程 seed 与镜头的锚点抽签：同一份编排重新编排结果不变，
     * 换 seed 就换一种分布。
     */
    probability: number;
    /**
     * 构图的变化 0..1：0 = 固定位置（立绘左右交替、横图居中）；越高越常换用远近、偏移、倾斜不同的构图，
     * 位置与大小也带一点抖动。同样按 seed 与镜头锚点抽签，重新编排结果不变。
     */
    variety: number;
}

export const DEFAULT_ARRANGE_OPTIONS: ArrangeOptions = {
    slot: 'mid',
    follow: 'scene',
    effect: 'none',
    effectColor: '#ffffff',
    motion: 'float',
    coverage: 'all',
    probability: 0.7,
    variety: 0.6,
};

export interface ArrangeImage {
    id: string;
    width: number;
    height: number;
}

const HIGHLIGHT_KINDS: ParagraphKind[] = ['chorus', 'lift', 'break'];
/** 副歌与上扬里的图稍微大一点。 */
const EMPHASIS_KINDS: ParagraphKind[] = ['chorus', 'lift'];
/** 短于这个时长的镜头不放图（图刚滑进来就要走）。 */
const MIN_SHOT = 1.5;

type Side = 'left' | 'right' | 'center';
type Shape = 'tall' | 'square' | 'wide';

/**
 * 一种构图。offset 是离画面中线的距离（center 的构图不分左右），y 是中心高度，scale 是图高占画面高的比例
 * （大于 1 就是出血、被画面边缘裁掉一部分），tilt 是倾斜（弧度，朝画面中间倾）。
 * 默认就是大图 + 一点倾斜，要有冲击力；每组的第一种是首选，变化度为 0 时只用它。
 */
interface Template {
    name: string;
    weight: number;
    center?: boolean;
    offset: number;
    y: number;
    scale: number;
    tilt: number;
}

const landscapeTemplates = (shape: Shape, frameAspect: number): Template[] => {
    const widescreen = frameAspect > 1.2;
    const side = widescreen ? 0.25 : 0.2;
    // 4:3、1:1 这类窄一点的画幅，同样高度的图占的横向比例更大，缩小一些。
    const k = widescreen ? 1 : 0.85;
    if (shape === 'tall') {
        return [
            { name: 'stand', weight: 3, offset: side, y: 0.56, scale: 1.1 * k, tilt: 0.04 },
            { name: 'close', weight: 2, offset: side + 0.04, y: 0.64, scale: 1.35 * k, tilt: 0.05 },
            { name: 'far', weight: 1.5, offset: side - 0.05, y: 0.54, scale: 0.88 * k, tilt: 0.06 },
            { name: 'center', weight: 0.6, center: true, offset: 0, y: 0.56, scale: 1 * k, tilt: 0.03 },
        ];
    }
    if (shape === 'square') {
        return [
            { name: 'card', weight: 3, offset: side, y: 0.53, scale: 1 * k, tilt: 0.035 },
            { name: 'close', weight: 2, offset: side + 0.05, y: 0.58, scale: 1.2 * k, tilt: 0.045 },
            { name: 'small', weight: 1.5, offset: side - 0.01, y: 0.46, scale: 0.72 * k, tilt: 0.07 },
        ];
    }
    return [
        { name: 'center', weight: 3, center: true, offset: 0, y: 0.5, scale: 0.66 * k, tilt: 0.025 },
        { name: 'aside', weight: 2, offset: widescreen ? 0.14 : 0.1, y: 0.47, scale: 0.56 * k, tilt: 0.05 },
        { name: 'low', weight: 1.5, center: true, offset: 0, y: 0.58, scale: 0.6 * k, tilt: 0.03 },
    ];
};

/** 竖屏：都在歌词下方的区域，变化只在左右微偏、高低与大小。 */
const verticalTemplates = (shape: Shape): Template[] => shape === 'tall'
    ? [
        { name: 'stand', weight: 3, center: true, offset: 0, y: 0.66, scale: 0.62, tilt: 0.03 },
        { name: 'aside', weight: 2, offset: 0.12, y: 0.68, scale: 0.56, tilt: 0.05 },
        { name: 'big', weight: 1, center: true, offset: 0, y: 0.74, scale: 0.74, tilt: 0.03 },
    ]
    : [
        { name: 'band', weight: 3, center: true, offset: 0, y: 0.7, scale: 0.32, tilt: 0.03 },
        { name: 'aside', weight: 2, offset: 0.08, y: 0.72, scale: 0.28, tilt: 0.05 },
        { name: 'low', weight: 1, center: true, offset: 0, y: 0.76, scale: 0.38, tilt: 0.03 },
    ];

/** 变化度越高，其余构图的权重越接近首选；和上一个镜头抽到同一种时（按变化度）再抽一次。 */
const pickTemplate = (templates: Template[], random: () => number, variety: number, previous: string | null) => {
    if (variety <= 0) return templates[0];
    const weights = templates.map((template, index) => (index === 0 ? template.weight : template.weight * variety));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const draw = () => {
        let roll = random() * total;
        const index = weights.findIndex(weight => (roll -= weight) <= 0);
        return templates[index < 0 ? templates.length - 1 : index];
    };
    const first = draw();
    return first.name === previous && random() < variety ? draw() : first;
};

/** 在相邻镜头之间传递的状态：左右交替与避免连续同一种构图。 */
interface LayoutState {
    lastSide: 'left' | 'right';
    sameSideRun: number;
    lastTemplate: string | null;
}

interface Placement {
    x: number;
    y: number;
    scale: number;
    rotation: number;
    enter: ClipAnimationType;
}

/** 默认入场：两侧的图从自己那一侧冲进来，居中的弹出来。 */
const ENTER_FROM: Record<Side, ClipAnimationType> = { left: 'rush-right', right: 'rush-left', center: 'pop' };
const SLIDE_FROM: Record<Side, ClipAnimationType> = { left: 'slide-right', right: 'slide-left', center: 'slide-up' };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 图在画面里的位置、大小与入场：取决于图的形状、画幅，以及这个镜头抽出的构图与抖动。 */
const placementOf = (image: ArrangeImage, frameAspect: number, random: () => number, variety: number, emphasis: boolean, state: LayoutState): Placement => {
    const aspect = image.width / Math.max(1, image.height);
    const shape: Shape = aspect < 0.9 ? 'tall' : aspect > 1.25 ? 'wide' : 'square';
    const vertical = frameAspect < 0.8;
    const template = pickTemplate(vertical ? verticalTemplates(shape) : landscapeTemplates(shape, frameAspect), random, variety, state.lastTemplate);
    state.lastTemplate = template.name;

    let side: Side = 'center';
    if (!template.center) {
        // 默认左右交替；变化度高时偶尔连着放同一侧，但最多连两次。
        const stay = state.sameSideRun < 2 && random() < 0.3 * variety;
        side = stay ? state.lastSide : state.lastSide === 'left' ? 'right' : 'left';
        state.sameSideRun = side === state.lastSide ? state.sameSideRun + 1 : 1;
        state.lastSide = side;
    }

    const jitter = (amount: number) => (random() * 2 - 1) * amount * variety;
    const direction = side === 'left' ? -1 : side === 'right' ? 1 : 0;
    const x = 0.5 + direction * template.offset + jitter(vertical ? 0.03 : 0.035);
    const y = template.y + jitter(0.03);
    const scale = template.scale * (1 + jitter(0.08)) * (emphasis ? 1 + 0.08 * variety : 1);
    // 倾斜朝向画面中间（上端往中间靠）；居中的朝上一张图的反方向，免得一直歪向同一边。
    const lean = direction === 0 ? (state.lastSide === 'left' ? -1 : 1) : -direction;
    const rotation = lean * template.tilt * (1 + jitter(0.3));

    // 竖屏的「偏一点」太小，不值得从侧面冲进来，一律弹出。偶尔换成轻一点的入场，免得每张都一样猛。
    let enter = vertical ? 'pop' : ENTER_FROM[side];
    if (random() < 0.3 * variety) {
        const alternatives: ClipAnimationType[] = vertical ? ['slide-up', 'zoom'] : side === 'center' ? ['zoom', 'slide-up'] : ['pop', SLIDE_FROM[side]];
        enter = alternatives[Math.floor(random() * alternatives.length)];
    }
    return { x: clamp(x, 0.08, 0.92), y: clamp(y, 0.2, 0.9), scale, rotation, enter };
};

const shotKey = (shot: LumiShot) => `${shot.anchor.line.index}:${shot.anchor.line.hash}:${shot.anchor.slot}`;

/**
 * 编排结果（不写工程）。images 按给定顺序轮流用，一个镜头一张；frameAspect = 画幅宽 / 高。
 * 没有图或没有合适的镜头时返回空数组。
 */
export const planAutoArrangement = (
    images: ArrangeImage[],
    program: LumiProgram,
    frameAspect: number,
    options: ArrangeOptions,
    makeId: () => string,
): AssetClip[] => {
    if (images.length === 0) return [];
    const shots = program.paragraphs
        .filter(paragraph => options.coverage === 'all' || HIGHLIGHT_KINDS.includes(paragraph.kind))
        .flatMap(paragraph => paragraph.shots.map(shot => ({ shot, emphasis: EMPHASIS_KINDS.includes(paragraph.kind) })))
        .filter(({ shot }) => shot.endTime - shot.startTime >= MIN_SHOT)
        // 抽签只看 seed 与镜头锚点：概率调低时，原来放了图的镜头里只会少掉一些，不会整个重新洗牌。
        .filter(({ shot }) => rng(program.seed, `auto-arrange:${shotKey(shot)}`) < options.probability);
    const effect = options.effect === 'none' ? undefined : normalizeClipEffect({ type: options.effect, color: options.effectColor });
    const variety = clamp(options.variety, 0, 1);
    const state: LayoutState = { lastSide: 'left', sameSideRun: 0, lastTemplate: null };
    return shots.map(({ shot, emphasis }, index) => {
        const image = images[index % images.length];
        // 构图也按镜头锚点播种：同一个镜头每次重新编排抽到的一样。
        const place = placementOf(image, frameAspect, createRng(`${program.seed}::auto-layout:${shotKey(shot)}`), variety, emphasis, state);
        return {
            ...DEFAULT_CLIP_LOOK,
            id: `${AUTO_CLIP_PREFIX}${makeId()}`,
            assetId: image.id,
            timing: { type: 'shot', anchor: shot.anchor },
            slot: options.slot,
            follow: options.follow,
            followAmount: 1,
            x: place.x,
            y: place.y,
            scale: place.scale,
            rotation: place.rotation,
            enter: { type: place.enter, duration: 0.55 },
            exit: { type: 'fade', duration: 0.5 },
            ...(effect ? { effect } : {}),
            ...(options.motion !== 'none' ? { motion: normalizeClipMotion({ type: options.motion, amount: 0.8 }) } : {}),
        };
    });
};
