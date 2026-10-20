// src/kernel/layerIds.ts
// 画面的层，按从下到上的顺序。分层导出把相邻的几层合进一个文件；叠回去与合成一致
// （转场擦除色块归入场景图形，片尾与画框装饰归入 overlay）。单独放一个文件，界面引用它不会把内核带进来。
export const KERNEL_LAYERS = ['background', 'assetsBack', 'graphics', 'assetsMid', 'text', 'assetsFront', 'subtitles', 'overlay', 'assetsTop'] as const;
export type KernelLayer = typeof KERNEL_LAYERS[number];
