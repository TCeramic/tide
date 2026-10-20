// src/core/audio/decode.ts
// 浏览器侧：解码音频文件、在 Worker 里做特征分析。
import type { AudioAnalysis } from './analysis';
import type { AnalysisMessage, AnalysisRequest } from './analysis.worker';

/** 统一解码到 48 kHz：Opus 只接受 48k，AAC 也常用它，导出时不必再重采样。 */
export const DECODE_SAMPLE_RATE = 48000;

export const decodeAudioBlob = async (blob: Blob): Promise<AudioBuffer> => {
    const data = await blob.arrayBuffer();
    const context = new OfflineAudioContext(2, 1, DECODE_SAMPLE_RATE);
    return context.decodeAudioData(data);
};

export const audioBufferChannels = (buffer: AudioBuffer): Float32Array[] => (
    Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
);

export const analyzeAudioBuffer = (
    buffer: AudioBuffer,
    onProgress?: (progress: number) => void,
): Promise<AudioAnalysis> => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<AnalysisMessage>) => {
        const message = event.data;
        if (message.type === 'progress') {
            onProgress?.(message.progress);
            return;
        }
        worker.terminate();
        if (message.type === 'done') resolve(message.analysis);
        else reject(new Error(message.message));
    };
    worker.onerror = event => {
        worker.terminate();
        reject(new Error(event.message || 'audio analysis worker failed'));
    };
    // 拷贝一份再转移，AudioBuffer 自己的数据还要留给播放与导出。
    const channels = audioBufferChannels(buffer).map(channel => channel.slice());
    worker.postMessage(
        { channels, sampleRate: buffer.sampleRate } satisfies AnalysisRequest,
        channels.map(channel => channel.buffer),
    );
});
