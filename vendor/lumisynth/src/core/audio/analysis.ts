// src/core/audio/analysis.ts
// 离线音频特征轨。复刻 folia 实时路径（AnalyserNode fftSize 2048、smoothingTimeConstant 0.6、
// 字节频谱 -100..-30 dB，再按频段取均值并做幂次提升），但按固定帧率从 PCM 算出来，
// 所以任意时刻的特征都是确定的：预览与逐帧导出看到的是同一组数值。
import { fft } from './fft';

export const AUDIO_BAND_NAMES = ['bass', 'lowMid', 'mid', 'vocal', 'treble'] as const;
export type AudioBandName = typeof AUDIO_BAND_NAMES[number];

/** 数值与 folia 的 audioPower / audioBands 同一量纲：0..255。 */
export interface AudioFrame {
    power: number;
    bass: number;
    lowMid: number;
    mid: number;
    vocal: number;
    treble: number;
}

export interface AudioAnalysis {
    /** 特征轨帧率。 */
    fps: number;
    duration: number;
    power: Float32Array;
    bands: Record<AudioBandName, Float32Array>;
    /** 波形：每桶 [min, max]，交错存放。 */
    peaks: Float32Array;
    peaksPerSecond: number;
}

export interface AnalyzeOptions {
    fps?: number;
    peaksPerSecond?: number;
    /** 进度回调，0..1。 */
    onProgress?: (progress: number) => void;
}

const FFT_SIZE = 2048;
const SMOOTHING = 0.6;
const MIN_DB = -100;
const MAX_DB = -30;

// folia usePlaybackVisualizerBridge 的频段与提升指数。
const BAND_RANGES: Record<AudioBandName, [number, number, number]> = {
    bass: [20, 150, 1.8],
    lowMid: [150, 400, 2],
    mid: [400, 1200, 2],
    vocal: [1000, 3500, 1.5],
    treble: [3500, 12000, 2],
};

const boost = (value: number, exponent: number) => Math.pow(value / 255, exponent) * 255;

// AnalyserNode 用的 Blackman 窗（alpha = 0.16）。
const blackman = (() => {
    const window = new Float64Array(FFT_SIZE);
    const a0 = 0.42, a1 = 0.5, a2 = 0.08;
    for (let i = 0; i < FFT_SIZE; i += 1) {
        const x = (2 * Math.PI * i) / FFT_SIZE;
        window[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x);
    }
    return window;
})();

export const mixToMono = (channels: Float32Array[]): Float32Array => {
    if (channels.length === 1) return channels[0];
    const length = channels[0]?.length ?? 0;
    const mono = new Float32Array(length);
    for (const channel of channels) {
        for (let i = 0; i < length; i += 1) mono[i] += channel[i];
    }
    const scale = 1 / channels.length;
    for (let i = 0; i < length; i += 1) mono[i] *= scale;
    return mono;
};

export const analyzeAudio = (
    samples: Float32Array,
    sampleRate: number,
    options: AnalyzeOptions = {},
): AudioAnalysis => {
    const fps = options.fps ?? 60;
    const peaksPerSecond = options.peaksPerSecond ?? 100;
    const duration = samples.length / sampleRate;
    const frameCount = Math.max(1, Math.ceil(duration * fps));
    const binWidth = sampleRate / FFT_SIZE;
    const binCount = FFT_SIZE / 2;

    const power = new Float32Array(frameCount);
    const bands = Object.fromEntries(
        AUDIO_BAND_NAMES.map(name => [name, new Float32Array(frameCount)]),
    ) as Record<AudioBandName, Float32Array>;
    const ranges = AUDIO_BAND_NAMES.map(name => {
        const [lo, hi, exponent] = BAND_RANGES[name];
        const start = Math.max(0, Math.floor(lo / binWidth));
        const end = Math.min(binCount - 1, Math.floor(hi / binWidth));
        return { name, start, end, exponent };
    });

    const re = new Float64Array(FFT_SIZE);
    const im = new Float64Array(FFT_SIZE);
    const smoothed = new Float64Array(binCount);
    const bytes = new Float64Array(binCount);
    const progressStep = Math.max(1, Math.floor(frameCount / 50));

    for (let frame = 0; frame < frameCount; frame += 1) {
        // 窗口末端对齐到该帧时刻，与实时 analyser 读到的「最近 2048 个样本」一致。
        const end = Math.round((frame / fps) * sampleRate);
        const start = end - FFT_SIZE;
        for (let i = 0; i < FFT_SIZE; i += 1) {
            const index = start + i;
            re[i] = index >= 0 && index < samples.length ? samples[index] * blackman[i] : 0;
            im[i] = 0;
        }
        fft(re, im);
        for (let k = 0; k < binCount; k += 1) {
            const magnitude = Math.hypot(re[k], im[k]) / FFT_SIZE;
            smoothed[k] = SMOOTHING * smoothed[k] + (1 - SMOOTHING) * magnitude;
            const db = smoothed[k] > 0 ? 20 * Math.log10(smoothed[k]) : -Infinity;
            bytes[k] = Math.min(255, Math.max(0, Math.floor((255 / (MAX_DB - MIN_DB)) * (db - MIN_DB))));
        }
        const raw: Partial<Record<AudioBandName, number>> = {};
        for (const range of ranges) {
            let sum = 0;
            for (let k = range.start; k <= range.end; k += 1) sum += bytes[k];
            const mean = sum / Math.max(1, range.end - range.start + 1);
            raw[range.name] = mean;
            bands[range.name][frame] = boost(mean, range.exponent);
        }
        power[frame] = boost(((raw.bass ?? 0) + (raw.lowMid ?? 0)) / 2, 3);
        if (options.onProgress && frame % progressStep === 0) options.onProgress(frame / frameCount);
    }

    const bucketCount = Math.max(1, Math.ceil(duration * peaksPerSecond));
    const peaks = new Float32Array(bucketCount * 2);
    const bucketSize = sampleRate / peaksPerSecond;
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
        const from = Math.floor(bucket * bucketSize);
        const to = Math.min(samples.length, Math.floor((bucket + 1) * bucketSize));
        let min = 0;
        let max = 0;
        for (let i = from; i < to; i += 1) {
            const value = samples[i];
            if (value < min) min = value;
            if (value > max) max = value;
        }
        peaks[bucket * 2] = min;
        peaks[bucket * 2 + 1] = max;
    }
    options.onProgress?.(1);
    return { fps, duration, power, bands, peaks, peaksPerSecond };
};

const SILENT_FRAME: AudioFrame = { power: 0, bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 };

/** 按时间取特征，帧间线性插值；没有分析结果时返回静音帧。 */
export const sampleAudioFrame = (analysis: AudioAnalysis | null | undefined, time: number): AudioFrame => {
    if (!analysis || analysis.power.length === 0 || !Number.isFinite(time)) return SILENT_FRAME;
    const position = Math.max(0, time * analysis.fps);
    const i0 = Math.min(analysis.power.length - 1, Math.floor(position));
    const i1 = Math.min(analysis.power.length - 1, i0 + 1);
    const t = Math.min(1, position - i0);
    const lerp = (track: Float32Array) => track[i0] + (track[i1] - track[i0]) * t;
    return {
        power: lerp(analysis.power),
        bass: lerp(analysis.bands.bass),
        lowMid: lerp(analysis.bands.lowMid),
        mid: lerp(analysis.bands.mid),
        vocal: lerp(analysis.bands.vocal),
        treble: lerp(analysis.bands.treble),
    };
};

/** 某时间段的平均响度（power），0..1。编译期估计段落 energy 用。 */
export const averageEnergy = (analysis: AudioAnalysis | null | undefined, from: number, to: number): number | null => {
    if (!analysis || analysis.power.length === 0 || !(to > from)) return null;
    const start = Math.max(0, Math.floor(from * analysis.fps));
    const end = Math.min(analysis.power.length, Math.ceil(to * analysis.fps));
    if (end <= start) return null;
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += analysis.power[i];
    return sum / (end - start) / 255;
};
