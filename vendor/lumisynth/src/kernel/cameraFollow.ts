// src/kernel/cameraFollow.ts
// 素材跟随运镜。包给出「运镜变换」：把没有运镜时的画面坐标映射到有运镜时的画面坐标（位移 + 等比缩放 + 旋转）。
// 素材按跟随方式与程度套上它：
// - scene：贴在场景上，就是当前镜头的运镜变换（切镜头时跟着跳，和场景里的东西一样）；
// - motion：只跟随镜头内的运动，相对镜头起点的运镜（每个镜头从原位开始，不跳）。
// 程度按画面中心分解成「缩放、旋转、中心位移」三部分再各自按比例缩小，所以 0.5 就是一半的运动。
import type { FollowMode } from '@/core/assets/clips';

/** 仿射矩阵：x' = a·x + c·y + tx，y' = b·x + d·y + ty。 */
export interface Affine {
    a: number;
    b: number;
    c: number;
    d: number;
    tx: number;
    ty: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

/** 容器的变换参数（与 Pixi 相同的含义：先减 pivot，再缩放、旋转，最后移到 position）。 */
export interface TransformParams {
    x: number;
    y: number;
    pivotX: number;
    pivotY: number;
    scale: number;
    rotation: number;
}

export const fromParams = ({ x, y, pivotX, pivotY, scale, rotation }: TransformParams): Affine => {
    const cos = Math.cos(rotation) * scale;
    const sin = Math.sin(rotation) * scale;
    return { a: cos, b: sin, c: -sin, d: cos, tx: x - (cos * pivotX - sin * pivotY), ty: y - (sin * pivotX + cos * pivotY) };
};

/** m ∘ n：先 n 再 m。 */
export const multiply = (m: Affine, n: Affine): Affine => ({
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    tx: m.a * n.tx + m.c * n.ty + m.tx,
    ty: m.b * n.tx + m.d * n.ty + m.ty,
});

export const invert = (m: Affine): Affine => {
    const det = m.a * m.d - m.b * m.c || 1e-12;
    return {
        a: m.d / det,
        b: -m.b / det,
        c: -m.c / det,
        d: m.a / det,
        tx: (m.c * m.ty - m.d * m.tx) / det,
        ty: (m.b * m.tx - m.a * m.ty) / det,
    };
};

export const apply = (m: Affine, x: number, y: number) => ({ x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty });

/** 运镜变换：没有运镜的容器变换 rest → 当前的容器变换 current。 */
export const cameraBetween = (rest: TransformParams, current: TransformParams): Affine => multiply(fromParams(current), invert(fromParams(rest)));

export interface Similarity {
    scale: number;
    rotation: number;
    /** 画面中心的位移。 */
    dx: number;
    dy: number;
}

/** 按中心 (cx, cy) 分解：m(p) = s·R·(p − c) + c + d。 */
export const decompose = (m: Affine, cx: number, cy: number): Similarity => {
    const center = apply(m, cx, cy);
    return { scale: Math.hypot(m.a, m.b), rotation: Math.atan2(m.b, m.a), dx: center.x - cx, dy: center.y - cy };
};

export const compose = ({ scale, rotation, dx, dy }: Similarity, cx: number, cy: number): Affine => (
    fromParams({ x: cx + dx, y: cy + dy, pivotX: cx, pivotY: cy, scale, rotation })
);


/** 包给出的某一时刻的运镜。 */
export interface CameraSample {
    matrix: Affine;
    /** 这一刻所在的镜头（motion 以它的起点为基准）。 */
    shotId: string;
    shotStart: number;
}

/**
 * 素材最终要套的变换。cameraAt(t) 取包在 t 时刻的运镜（没有时为 null）。
 * 程度 0 或 off 时是单位变换。
 */
export const resolveFollow = (
    mode: FollowMode | undefined,
    amount: number | undefined,
    time: number,
    cameraAt: (time: number) => CameraSample | null,
    width: number,
    height: number,
): Affine => {
    const k = Math.max(0, Math.min(1, amount ?? 1));
    if (!mode || mode === 'off' || k === 0) return IDENTITY;
    const sample = cameraAt(time);
    if (!sample) return IDENTITY;
    let matrix = sample.matrix;
    if (mode === 'motion') {
        const start = cameraAt(sample.shotStart);
        if (start && start.shotId === sample.shotId) matrix = multiply(matrix, invert(start.matrix));
    }
    if (k === 1) return matrix;
    const cx = width / 2;
    const cy = height / 2;
    const full = decompose(matrix, cx, cy);
    return compose({
        scale: 1 + (full.scale - 1) * k,
        rotation: full.rotation * k,
        dx: full.dx * k,
        dy: full.dy * k,
    }, cx, cy);
};
