// src/kernel/tuning.ts
// 内核统一接管的观感设置：背景、转场开关、唯一的后处理链。两个包 tuning 里的同名字段在内核模式下
// 不再生效（包的 scene 不再自带后处理）。

export type BackgroundMode = 'theme' | 'cover';

export interface KernelTuning {
    background: {
        mode: BackgroundMode;
        /** 封面背景的模糊半径（逻辑像素）与压暗程度 0..1。 */
        coverBlur: number;
        coverDim: number;
    };
    enableTransitions: boolean;
    /** 全局倍率，乘在两包各自的镜头强度 / 文字运动强度上，混用时两包的动感保持一致。 */
    motion: {
        camera: number;
        typography: number;
    };
    postProcess: {
        enabled: boolean;
        grain: number;
        contrast: number;
        rgbShift: number;
        halftone: number;
        vignette: number;
        lensDistortion: number;
        lensDispersion: number;
    };
    /** 画在画面底部的第二行文字（原 folia 的 DOM 字幕层；要能导出，所以画进 Pixi）。 */
    subtitles: {
        mode: 'translation' | 'romanization' | 'none';
        scale: number;
        opacity: number;
    };
    /** 预览的渲染倍率；导出按目标分辨率另算。 */
    previewResolution: number;
}

export const DEFAULT_KERNEL_TUNING: KernelTuning = {
    background: { mode: 'theme', coverBlur: 24, coverDim: 0.55 },
    enableTransitions: true,
    motion: { camera: 1, typography: 1 },
    postProcess: {
        enabled: true,
        grain: 0.2,
        contrast: 0,
        rgbShift: 0,
        halftone: 0,
        vignette: 0.85,
        lensDistortion: 0.3,
        lensDispersion: 0,
    },
    subtitles: { mode: 'translation', scale: 1, opacity: 0.6 },
    previewResolution: 1,
};
