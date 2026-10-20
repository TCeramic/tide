// src/kernel/adapters/types.ts
// 风格包接入内核的契约（路线 C/D）：包负责构建与每帧更新自己的场景单元、片尾卡、画框装饰；
// 背景、转场、后处理、译文、调度都归内核。
import type { Theme } from '@/core/types';
import type { AudioFrame } from '@/core/audio/analysis';
import type { PackId } from '@/packs/contract';
import type { KernelTuning } from '../tuning';
import type { KernelTransitionFrame } from '../transitions';
import type { SceneUnit } from '../units';
import type { CameraSample } from '../cameraFollow';

export interface KernelTunings {
    kernel: KernelTuning;
    packs: Record<PackId, unknown>;
}

export type PixiModule = typeof import('pixi.js');
export type Container = import('pixi.js').Container;

export interface SongMetadata {
    title: string | null;
    artist: string | null;
    album: string | null;
}

export interface KernelContext {
    pixi: PixiModule;
    width: number;
    height: number;
    /** 渲染目标实际的分辨率（导出时即输出倍率）。 */
    renderResolution: number;
    programSeed: string;
    theme: Theme;
    /** 歌词字号倍率（工程的字体设置）。 */
    lyricsFontScale: number;
    /** 内核自己的观感设置，以及每个包自己的 tuning（按包 id，结构由包决定）。 */
    tunings: KernelTunings;
    metadata: SongMetadata;
    coverColors: string[];
    /** 场景构建器只读 clientWidth / clientHeight。 */
    host: HTMLDivElement;
    /** 用户的图片池（id → 文件），用不用、怎么用由包决定。 */
    images: Map<string, Blob>;
    audioAt: (time: number) => AudioFrame;
}

export interface UnitFrame {
    time: number;
    width: number;
    height: number;
}

export interface UnitView {
    unit: SceneUnit;
    container: Container;
    /** 更新到时刻 time。返回包内部的 shot 级转场帧（sonnet），没有则返回 null。 */
    update: (frame: UnitFrame, transitionsEnabled: boolean) => KernelTransitionFrame | null;
    /** 该单元不可见时调用：释放已上传到 GPU 的资源，下次显示时再恢复。 */
    hide: () => void;
    /**
     * 分层导出：只画图形（构图、MG、装饰）或只画文字。用 Pixi 的 renderable 实现，不碰包自己每帧改的 visible。
     * 不提供时内核把整个单元当作图形与文字都有（两者都关才隐藏）。
     */
    setLayerVisibility?: (layers: { graphics: boolean; text: boolean; mid: boolean }) => void;
    /**
     * 「场景之上、歌词之下」的素材插入层：time 时刻所在镜头里，图形与文字之间的一个空容器。
     * 内核把这一层级的素材每帧放进去（按容器的变换反算，屏幕上的位置不受镜头影响）。
     * 不提供时这一层级的素材画在整个场景之上。
     */
    midLayer?: (time: number) => Container | null;
    /**
     * 素材跟随运镜：time 时刻所在镜头的运镜变换（没有运镜时的画面坐标 → 有运镜时的画面坐标）。
     * 必须只由 time 决定（motion 方式还会取镜头起点那一刻），并与逐帧更新用同一份计算。
     * 不提供时跟随运镜的素材不动。
     */
    camera?: (time: number) => CameraSample | null;
    /** 擦除色块的颜色（tempera 取调色板 tone3）。 */
    wipeColor: string;
    /** 离开时的运动方向（tempera 取末个 shot 的 flow），进入时的方向（首个 shot 的 flow）。 */
    exitFlowAngle: number;
    enterFlowAngle: number;
    /** sonnet 的场景转场种子。 */
    transitionSeed: number;
    destroy: () => void;
}

export interface CreditsFrame {
    active: boolean;
    lyricAlpha: number;
    lyricBlur: number;
    posterAlpha: number;
    posterOffsetY: number;
    posterScale: number;
}

export interface CreditsView {
    container: Container;
    /** 片尾卡以自身原点为中心绘制时为 true（tempera），否则以视口为坐标（sonnet）。 */
    centered: boolean;
    resolveFrame: (time: number, finalEndTime: number) => CreditsFrame;
    update: (elapsed: number) => void;
    destroy: () => void;
}

export interface PackAdapter {
    id: PackId;
    /** 异步准备共享资源（sonnet 的图标纹理、tempera 的图片池）；上下文变化后会再次调用。 */
    prepare: (context: KernelContext) => Promise<void>;
    buildUnit: (context: KernelContext, unit: SceneUnit) => UnitView;
    buildCredits: (context: KernelContext, palette?: unknown) => CreditsView | null;
    /** 画框装饰（sonnet 的外框、tempera 的角标），没有则返回 null。 */
    buildOverlay: (context: KernelContext) => Container | null;
    dispose: () => void;
}
