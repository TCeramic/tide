/// <reference lib="webworker" />
import { analyzeAudio, mixToMono } from './analysis';

export interface AnalysisRequest {
    channels: Float32Array[];
    sampleRate: number;
}

export type AnalysisMessage =
    | { type: 'progress'; progress: number }
    | { type: 'done'; analysis: ReturnType<typeof analyzeAudio> }
    | { type: 'error'; message: string };

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
    try {
        const { channels, sampleRate } = event.data;
        const analysis = analyzeAudio(mixToMono(channels), sampleRate, {
            onProgress: progress => self.postMessage({ type: 'progress', progress } satisfies AnalysisMessage),
        });
        const transfer = [analysis.power.buffer, analysis.peaks.buffer, ...Object.values(analysis.bands).map(b => b.buffer)];
        self.postMessage({ type: 'done', analysis } satisfies AnalysisMessage, { transfer });
    } catch (error) {
        self.postMessage({ type: 'error', message: (error as Error).message } satisfies AnalysisMessage);
    }
};
