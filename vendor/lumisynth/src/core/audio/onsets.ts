// src/core/audio/onsets.ts
// 起音点：逐字时间拖动时的吸附目标。用离线特征轨里人声 + 中频两个频段的正向变化（近似频谱通量），
// 在自适应阈值上取局部峰。结果只由特征轨决定，按分析结果缓存。
import type { AudioAnalysis } from './analysis';

const cache = new WeakMap<AudioAnalysis, number[]>();

/** 最近两个起音点至少隔多久（秒）。 */
const MIN_SPACING = 0.06;

export const detectOnsets = (analysis: AudioAnalysis): number[] => {
    const cached = cache.get(analysis);
    if (cached) return cached;
    const { fps } = analysis;
    const vocal = analysis.bands.vocal;
    const mid = analysis.bands.mid;
    const count = Math.min(vocal.length, mid.length);
    const flux = new Float32Array(count);
    for (let i = 1; i < count; i += 1) {
        flux[i] = Math.max(0, vocal[i] + mid[i] - vocal[i - 1] - mid[i - 1]);
    }
    const radius = Math.max(2, Math.round(fps * 0.1));
    const peakRadius = Math.max(1, Math.round(fps * 0.03));
    const onsets: number[] = [];
    let windowSum = 0;
    for (let i = 0; i < Math.min(count, radius); i += 1) windowSum += flux[i];
    for (let i = 0; i < count; i += 1) {
        // 滑动窗口 [i - radius, i + radius) 的均值。
        if (i + radius < count) windowSum += flux[i + radius];
        if (i - radius - 1 >= 0) windowSum -= flux[i - radius - 1];
        const span = Math.min(count, i + radius) - Math.max(0, i - radius - 1) - 1;
        const threshold = (windowSum / Math.max(1, span)) * 1.4 + 2;
        if (flux[i] <= threshold) continue;
        let isPeak = true;
        for (let j = Math.max(0, i - peakRadius); j <= Math.min(count - 1, i + peakRadius); j += 1) {
            if (flux[j] > flux[i] || (flux[j] === flux[i] && j < i)) {
                isPeak = false;
                break;
            }
        }
        if (!isPeak) continue;
        const time = i / fps;
        if (onsets.length > 0 && time - onsets[onsets.length - 1] < MIN_SPACING) continue;
        onsets.push(time);
    }
    cache.set(analysis, onsets);
    return onsets;
};

/** 离 time 最近、且在 tolerance 之内的时刻（没有就返回 null）。candidates 按时间升序。 */
export const nearestTime = (candidates: number[], time: number, tolerance: number): number | null => {
    let low = 0;
    let high = candidates.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (candidates[middle] < time) low = middle + 1;
        else high = middle;
    }
    let best: number | null = null;
    for (const index of [low - 1, low]) {
        const candidate = candidates[index];
        if (candidate === undefined) continue;
        if (Math.abs(candidate - time) <= tolerance && (best === null || Math.abs(candidate - time) < Math.abs(best - time))) best = candidate;
    }
    return best;
};
