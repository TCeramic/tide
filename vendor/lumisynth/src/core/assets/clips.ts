// src/core/assets/clips.ts
// 通用素材层：用户放在画面上的图片片段。与风格包无关，由内核绘制。
// 时间可以挂在歌词行 / 段落 / 镜头上（改编排后跟着走），也可以是绝对时间；
// 动画（入场 / 退场）只由时间决定，逐帧导出与预览一致。
import type { LineAnchor } from '@/core/lyrics/edits';
import type { LumiProgram, ParagraphAnchor, ShotAnchor } from '@/compiler/types';

/**
 * 层级：back 在背景之上、场景之下；mid 在场景的图形之上、歌词之下（凝彩原版图片池的位置，
 * 由包在每个镜头里留出插入层，歌词的反色会读到它）；front 在整个场景（含歌词）之上、字幕之下；overlay 在最上面。
 */
export type AssetSlot = 'back' | 'mid' | 'front' | 'overlay';
export const ASSET_SLOTS: AssetSlot[] = ['back', 'mid', 'front', 'overlay'];

export type AssetBlend = 'normal' | 'add' | 'multiply' | 'screen';

export type ClipTiming =
    | { type: 'song' }
    | { type: 'absolute'; start: number; end: number }
    | { type: 'lines'; from: LineAnchor; to: LineAnchor }
    | { type: 'paragraph'; anchor: ParagraphAnchor }
    | { type: 'shot'; anchor: ShotAnchor };

/**
 * slide-* 从近处轻轻滑入；rush-* 从画面外快速冲进来、冲过头一点再回位，带一点随速度的倾斜
 * （方向同 slide-*：rush-left 往左冲 = 从右边进来）；pop 从小弹到略大再回落，带一点扭转。
 */
export type ClipAnimationType = 'none' | 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'zoom' | 'rush-left' | 'rush-right' | 'pop';
export const CLIP_ANIMATIONS: ClipAnimationType[] = ['none', 'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom', 'rush-left', 'rush-right', 'pop'];

export interface ClipAnimation {
    type: ClipAnimationType;
    /** 秒。 */
    duration: number;
}

/**
 * 附加效果：用和图片同形状的纯色剪影做的装饰（ADV 游戏 PV 里立绘常见的那几种）。
 * echo 重影扩张：几层剪影从原图的轮廓一圈圈放大、淡出，循环；glow 外发光：模糊的剪影衬在后面；
 * shadow 投影剪影：同形状的纯色剪影向右下偏移。都画在原图之下，随原图一起移动、缩放、淡入淡出。
 */
export type ClipEffectType = 'none' | 'echo' | 'glow' | 'shadow';
export const CLIP_EFFECTS: ClipEffectType[] = ['none', 'echo', 'glow', 'shadow'];

export interface ClipEffect {
    type: ClipEffectType;
    /** 剪影的颜色（#rrggbb）。 */
    color: string;
    /** 0..1：重影扩张的幅度 / 光晕的半径 / 投影的偏移。 */
    size: number;
    /** 0..1：效果本身的不透明度。 */
    opacity: number;
    /** 重影扩张一轮的时长（秒）。 */
    period: number;
}

export const DEFAULT_CLIP_EFFECT: ClipEffect = { type: 'none', color: '#ffffff', size: 0.5, opacity: 0.6, period: 1.6 };

/** 补齐旧工程里没有的字段、夹住越界的值。 */
export const normalizeClipEffect = (raw: Partial<ClipEffect> | null | undefined): ClipEffect => {
    const effect = { ...DEFAULT_CLIP_EFFECT, ...(raw ?? {}) };
    return {
        type: CLIP_EFFECTS.includes(effect.type) ? effect.type : 'none',
        color: /^#[0-9a-f]{6}$/i.test(effect.color) ? effect.color.toLowerCase() : DEFAULT_CLIP_EFFECT.color,
        size: Math.min(1, Math.max(0, Number(effect.size) || 0)),
        opacity: Math.min(1, Math.max(0, Number(effect.opacity) || 0)),
        period: Math.min(8, Math.max(0.3, Number(effect.period) || DEFAULT_CLIP_EFFECT.period)),
    };
};

/** 重影扩张同时有几层。 */
export const ECHO_LAYERS = 3;

/**
 * 重影扩张在片段开始后 elapsed 秒的各层（纯函数，逐帧导出与预览一致）：每层错开 1/层数 个周期，
 * 从原图大小放大到 1 + 幅度，同时淡出。
 */
export const echoLayers = (effect: ClipEffect, elapsed: number): Array<{ scale: number; alpha: number }> => {
    const spread = 0.05 + effect.size * 0.35;
    return Array.from({ length: ECHO_LAYERS }, (_, index) => {
        const phase = (((Math.max(0, elapsed) / effect.period) + index / ECHO_LAYERS) % 1 + 1) % 1;
        return { scale: 1 + spread * phase, alpha: effect.opacity * (1 - phase) ** 1.6 };
    });
};

/** 外发光的模糊半径与投影的偏移，都按图片高度的比例算（与图片在画面上多大无关）。 */
export const glowRadiusOf = (effect: ClipEffect) => 0.01 + effect.size * 0.07;
export const shadowOffsetOf = (effect: ClipEffect) => 0.01 + effect.size * 0.07;

/**
 * 持续运动：片段显示期间一直在进行的简单路径动画（绘光这类几乎没有运镜的场景里，素材不至于完全静止）。
 * float 上下漂浮；drift 整段时间里缓缓往画面中间横移；push 缓慢推近放大；sway 带一点旋转的摇摆。
 */
export type ClipMotionType = 'none' | 'float' | 'drift' | 'push' | 'sway';
export const CLIP_MOTIONS: ClipMotionType[] = ['none', 'float', 'drift', 'push', 'sway'];

export interface ClipMotion {
    type: ClipMotionType;
    /** 幅度 0..1。 */
    amount: number;
}

export const DEFAULT_CLIP_MOTION: ClipMotion = { type: 'none', amount: 0.5 };

export const normalizeClipMotion = (raw: Partial<ClipMotion> | null | undefined): ClipMotion => {
    const motion = { ...DEFAULT_CLIP_MOTION, ...(raw ?? {}) };
    return {
        type: CLIP_MOTIONS.includes(motion.type) ? motion.type : 'none',
        amount: Math.min(1, Math.max(0, Number(motion.amount) || 0)),
    };
};

/**
 * CSS 的 cubic-bezier(x1, y1, x2, y2) 缓动：给定时间进度 t（0..1）求曲线上的进度。
 * 先用牛顿迭代解出参数 u 使 x(u) = t（不收敛时退回二分），再取 y(u)。
 */
export const cubicBezierEase = (x1: number, y1: number, x2: number, y2: number) => {
    const bez = (u: number, a: number, b: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3;
    const slope = (u: number, a: number, b: number) => 3 * a * (1 - u) ** 2 + 6 * (b - a) * u * (1 - u) + 3 * (1 - b) * u ** 2;
    return (t: number) => {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        let u = t;
        for (let i = 0; i < 8; i += 1) {
            const dx = bez(u, x1, x2) - t;
            const d = slope(u, x1, x2);
            if (Math.abs(dx) < 1e-6) return bez(u, y1, y2);
            if (Math.abs(d) < 1e-6) break;
            u -= dx / d;
        }
        let lo = 0;
        let hi = 1;
        u = t;
        for (let i = 0; i < 30; i += 1) {
            const x = bez(u, x1, x2);
            if (Math.abs(x - t) < 1e-6) break;
            if (x < t) lo = u;
            else hi = u;
            u = (lo + hi) / 2;
        }
        return bez(u, y1, y2);
    };
};

/** 路径动画默认的缓动：两头都慢、中间顺滑（接近 easeInOutSine），起停都没有顿挫。 */
export const MOTION_EASE = cubicBezierEase(0.37, 0, 0.63, 1);

type Point = { x: number; y: number };
/** 三次贝塞尔曲线上参数 u 处的点。 */
const bezierPoint = (p0: Point, p1: Point, p2: Point, p3: Point, u: number): Point => {
    const v = 1 - u;
    return {
        x: v ** 3 * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u ** 3 * p3.x,
        y: v ** 3 * p0.y + 3 * v * v * u * p1.y + 3 * v * u * u * p2.y + u ** 3 * p3.y,
    };
};

/** 往返：每半个周期从 0 缓动到 1、再缓动回 0，两端自然停顿。 */
const yoyo = (t: number, period: number) => {
    const phase = ((t / period) % 1 + 1) % 1;
    return MOTION_EASE(phase < 0.5 ? phase * 2 : 2 - phase * 2);
};

/**
 * 持续运动在片段开始后 elapsed 秒（片段总长 length）的位移（相对画面宽高）、缩放倍数与旋转（弧度）。
 * 路径都是三次贝塞尔曲线，速度都走 MOTION_EASE，所以起停柔和、轨迹带弧度。纯函数；
 * x 是片段的中心位置，决定横移往哪边走（往画面中间）。
 */
export const evaluateMotion = (motion: ClipMotion, elapsed: number, length: number, x: number) => {
    const a = motion.amount;
    const t = Math.max(0, elapsed);
    const progress = MOTION_EASE(length > 0 ? Math.min(1, t / length) : 0);
    switch (motion.type) {
        case 'float': {
            // 沿一段上凸的弧线来回：往上时略往右，回落时略往左（S 形的往返）。
            const p = bezierPoint({ x: -0.004, y: 0.012 }, { x: 0.01, y: 0.004 }, { x: -0.01, y: -0.004 }, { x: 0.004, y: -0.012 }, yoyo(t, 5));
            return { dx: p.x * a, dy: p.y * a, scale: 1, rotation: 0 };
        }
        case 'drift': {
            // 整段时间沿一条平缓的 S 形曲线往画面中间滑过去。
            const direction = x < 0.5 ? 1 : -1;
            const p = bezierPoint({ x: -0.05, y: 0.008 }, { x: -0.017, y: -0.014 }, { x: 0.017, y: 0.014 }, { x: 0.05, y: -0.008 }, progress);
            return { dx: p.x * a * direction, dy: p.y * a, scale: 1, rotation: 0 };
        }
        case 'push': {
            // 缓慢推近：放大的同时沿弧线微微上移，像镜头往前推。
            const p = bezierPoint({ x: 0, y: 0 }, { x: 0.004, y: -0.004 }, { x: 0.002, y: -0.012 }, { x: 0, y: -0.016 }, progress);
            return { dx: p.x * a, dy: p.y * a, scale: 1 + progress * 0.12 * a, rotation: 0 };
        }
        case 'sway': {
            // 摇摆：转角与位置一起按缓动来回，重心沿弧线移动（像挂着的东西在摆）。
            const u = yoyo(t, 6);
            const p = bezierPoint({ x: -0.008, y: 0 }, { x: -0.004, y: -0.006 }, { x: 0.004, y: -0.006 }, { x: 0.008, y: 0 }, u);
            return { dx: p.x * a, dy: p.y * a, scale: 1, rotation: (u * 2 - 1) * 0.05 * a };
        }
        default:
            return { dx: 0, dy: 0, scale: 1, rotation: 0 };
    }
};

export interface AssetClip {
    id: string;
    /** 素材库里的素材 id。 */
    assetId: string;
    timing: ClipTiming;
    /** 在挂载的时间范围之外提前出现 / 延后消失（秒，可为负）。 */
    lead: number;
    tail: number;
    slot: AssetSlot;
    /** 中心位置（相对画面宽高 0..1）。 */
    x: number;
    y: number;
    /** 高度占画面高度的比例。 */
    scale: number;
    /** 弧度。 */
    rotation: number;
    opacity: number;
    flipX: boolean;
    blend: AssetBlend;
    enter: ClipAnimation;
    exit: ClipAnimation;
    /**
     * 跟随运镜（见 kernel/cameraFollow.ts）：off 不动；scene 贴在场景上（切镜头时跟着跳）；
     * motion 只跟随镜头内的运动（每个镜头从原位开始）。位置、大小、角度都是没有运镜时的值。
     */
    follow: FollowMode;
    /** 跟随程度 0..1（像视差深度）。 */
    followAmount: number;
    /** 附加效果；旧工程没有这个字段，按「无」处理。 */
    effect?: ClipEffect;
    /** 持续运动；旧工程没有这个字段，按「无」处理。 */
    motion?: ClipMotion;
}

export interface ResolvedAssetClip extends AssetClip {
    start: number;
    end: number;
}

export type FollowMode = 'off' | 'scene' | 'motion';
export const FOLLOW_MODES: FollowMode[] = ['off', 'scene', 'motion'];

export const DEFAULT_CLIP_LOOK: Pick<AssetClip, 'lead' | 'tail' | 'slot' | 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'flipX' | 'blend' | 'enter' | 'exit' | 'follow' | 'followAmount'> = {
    lead: 0,
    tail: 0,
    slot: 'front',
    x: 0.5,
    y: 0.5,
    scale: 0.5,
    rotation: 0,
    opacity: 1,
    flipX: false,
    blend: 'normal',
    enter: { type: 'fade', duration: 0.4 },
    exit: { type: 'fade', duration: 0.4 },
    follow: 'off',
    followAmount: 1,
};

const sameLine = (a: LineAnchor, b: LineAnchor) => a.index === b.index && a.hash === b.hash;

/** 挂载点在当前编排里的时间范围；锚点失效时返回 null。 */
/** 「全曲」的结束：远大于任何歌曲（含片尾），时间轴上按歌曲时长截断显示。 */
export const SONG_END = 1e7;

export const resolveClipRange = (timing: ClipTiming, program: LumiProgram): { start: number; end: number } | null => {
    if (timing.type === 'song') return { start: 0, end: SONG_END };
    if (timing.type === 'absolute') return { start: timing.start, end: Math.max(timing.start, timing.end) };
    if (timing.type === 'lines') {
        const from = program.lines[timing.from.index];
        const to = program.lines[timing.to.index];
        if (!from || !to || !sameLine(from.anchor, timing.from) || !sameLine(to.anchor, timing.to)) return null;
        return { start: from.line.startTime, end: Math.max(from.line.startTime, to.renderEndTime) };
    }
    if (timing.type === 'paragraph') {
        const paragraph = program.paragraphs.find(item => sameLine(item.anchor.line, timing.anchor.line));
        return paragraph ? { start: paragraph.startTime, end: paragraph.endTime } : null;
    }
    for (const paragraph of program.paragraphs) {
        const shot = paragraph.shots.find(item => sameLine(item.anchor.line, timing.anchor.line) && item.anchor.slot === timing.anchor.slot);
        if (shot) return { start: shot.startTime, end: shot.endTime };
    }
    return null;
};

export interface ClipResolution {
    resolved: ResolvedAssetClip[];
    /** 锚点失效或素材不存在的片段。 */
    invalid: Array<{ clip: AssetClip; reason: 'anchor-missing' | 'asset-missing' }>;
}

export const resolveAssetClips = (clips: AssetClip[], program: LumiProgram, assetIds: Set<string>): ClipResolution => {
    const resolved: ResolvedAssetClip[] = [];
    const invalid: ClipResolution['invalid'] = [];
    clips.forEach(clip => {
        if (!assetIds.has(clip.assetId)) {
            invalid.push({ clip, reason: 'asset-missing' });
            return;
        }
        const range = resolveClipRange(clip.timing, program);
        if (!range) {
            invalid.push({ clip, reason: 'anchor-missing' });
            return;
        }
        const start = range.start - clip.lead;
        resolved.push({ ...clip, start, end: Math.max(start + 0.05, range.end + clip.tail) });
    });
    return { resolved, invalid };
};

export interface ClipFrame {
    visible: boolean;
    alpha: number;
    /** 相对画面宽高的位移。 */
    dx: number;
    dy: number;
    scale: number;
    /** 叠加在片段角度上的旋转（弧度）。 */
    rotation: number;
}

const HIDDEN: ClipFrame = { visible: false, alpha: 0, dx: 0, dy: 0, scale: 1, rotation: 0 };
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (value: number) => 1 - (1 - value) ** 3;
/** 冲过头再回位的缓出（easeOutBack）：中途超过 1 约 6%，终点回到 1。 */
const easeOutBack = (value: number) => {
    const c1 = 1.4;
    return 1 + (c1 + 1) * (value - 1) ** 3 + c1 * (value - 1) ** 2;
};

/** 动画进度 p（0 = 完全未出现，1 = 完全出现）对应的变化。 */
const animate = (type: ClipAnimationType, p: number) => {
    const q = 1 - easeOut(p);
    switch (type) {
        case 'fade': return { alpha: easeOut(p), dx: 0, dy: 0, scale: 1, rotation: 0 };
        case 'slide-up': return { alpha: easeOut(p), dx: 0, dy: 0.12 * q, scale: 1, rotation: 0 };
        case 'slide-down': return { alpha: easeOut(p), dx: 0, dy: -0.12 * q, scale: 1, rotation: 0 };
        case 'slide-left': return { alpha: easeOut(p), dx: 0.12 * q, dy: 0, scale: 1, rotation: 0 };
        case 'slide-right': return { alpha: easeOut(p), dx: -0.12 * q, dy: 0, scale: 1, rotation: 0 };
        case 'zoom': return { alpha: easeOut(p), dx: 0, dy: 0, scale: 0.8 + 0.2 * easeOut(p), rotation: 0 };
        case 'rush-left':
        case 'rush-right': {
            // 从约半个画面外冲进来；前 30% 就完全不透明，冲的过程看得见。倾斜顺着来的方向，随速度回正。
            const from = type === 'rush-left' ? 1 : -1;
            return { alpha: easeOut(clamp01(p / 0.3)), dx: from * 0.55 * (1 - easeOutBack(p)), dy: 0, scale: 1.06 - 0.06 * easeOut(p), rotation: from * 0.14 * q };
        }
        case 'pop': return { alpha: easeOut(clamp01(p / 0.4)), dx: 0, dy: 0.03 * q, scale: 0.55 + 0.45 * easeOutBack(p), rotation: -0.12 * q };
        default: return { alpha: 1, dx: 0, dy: 0, scale: 1, rotation: 0 };
    }
};

/** 片段在时刻 time 的状态（纯函数）。入场与退场在片段很短时按比例压缩，不会互相越界。 */
export const evaluateClip = (clip: ResolvedAssetClip, time: number): ClipFrame => {
    if (time < clip.start || time >= clip.end) return HIDDEN;
    const length = clip.end - clip.start;
    const enterDuration = clip.enter.type === 'none' ? 0 : Math.min(clip.enter.duration, length / 2);
    const exitDuration = clip.exit.type === 'none' ? 0 : Math.min(clip.exit.duration, length / 2);
    let frame = { alpha: 1, dx: 0, dy: 0, scale: 1, rotation: 0 };
    if (enterDuration > 0 && time < clip.start + enterDuration) {
        frame = animate(clip.enter.type, clamp01((time - clip.start) / enterDuration));
    } else if (exitDuration > 0 && time > clip.end - exitDuration) {
        frame = animate(clip.exit.type, clamp01((clip.end - time) / exitDuration));
    }
    // 持续运动叠在入场 / 退场动画上。
    const motion = evaluateMotion(normalizeClipMotion(clip.motion), time - clip.start, length, clip.x);
    return {
        visible: true,
        alpha: frame.alpha,
        dx: frame.dx + motion.dx,
        dy: frame.dy + motion.dy,
        scale: frame.scale * motion.scale,
        rotation: frame.rotation + motion.rotation,
    };
};
