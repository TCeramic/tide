// src/app/waveform.ts
// 波形绘制（时间轴与歌词面板的逐字条共用）：每个像素列取对应时间段里的最小 / 最大采样。
import type { AudioAnalysis } from '@/core/audio/analysis';

export const drawWaveform = (
    context: CanvasRenderingContext2D,
    analysis: AudioAnalysis,
    width: number,
    height: number,
    /** 第 x 个像素列左边缘对应的时刻（秒）。 */
    timeAtX: (x: number) => number,
    color = 'rgba(161,161,170,0.55)',
) => {
    const { peaks, peaksPerSecond } = analysis;
    const buckets = peaks.length / 2;
    const mid = height / 2;
    context.fillStyle = color;
    for (let x = 0; x < width; x += 1) {
        const t0 = timeAtX(x);
        const t1 = timeAtX(x + 1);
        if (t1 <= 0) continue;
        const b0 = Math.max(0, Math.floor(t0 * peaksPerSecond));
        const b1 = Math.max(b0 + 1, Math.floor(t1 * peaksPerSecond));
        if (b0 >= buckets) break;
        let min = 0;
        let max = 0;
        for (let b = b0; b < Math.min(b1, buckets); b += 1) {
            min = Math.min(min, peaks[b * 2]);
            max = Math.max(max, peaks[b * 2 + 1]);
        }
        const top = mid - max * mid * 0.95;
        const bottom = mid - min * mid * 0.95;
        context.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
};

/** 按设备像素比准备好画布，返回已缩放、清空的 2D 上下文。 */
export const prepareCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    return context;
};
