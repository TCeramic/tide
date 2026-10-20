// src/packs/hanabi/mg/glow.ts
// 烟花层的辉光：复用共享的 dual-filter bloom（_shared/bloomFilter.ts：亮部提取 → 逐级降采样 → 上采样叠加），参数调成花火的「热芯 + 宽光晕」。
// 只在 tuning.glow > 0 时由 scene 挂到烟花层上；强度随 tuning 变化时调 setHanabiGlow，不必重建。
import { createBloomFilter, type BloomFilter } from '@/packs/_shared/bloomFilter';
import type { PixiModule } from '../types';

const BASE = {
    strength: 1.1,
    threshold: 0.2,
    knee: 0.25,
    levels: 5,
    spread: 0.85,
    tint: [1, 0.96, 0.9] as [number, number, number],
};

/** amount = tuning.glow（0..2）；padding 让光晕能晕出烟花层的包围盒（逻辑像素）。 */
export const createHanabiGlow = (pixi: PixiModule, amount: number, padding = 48): BloomFilter =>
    createBloomFilter(pixi, { ...BASE, strength: BASE.strength * Math.max(0, amount), padding });

export const setHanabiGlow = (filter: BloomFilter, amount: number) => {
    filter.options.strength = BASE.strength * Math.max(0, amount);
};
