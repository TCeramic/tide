// src/export/exporter.ts
// 导出视频：一个离屏内核按固定帧率逐帧 renderAt(t)，WebCodecs 编码、mediabunny 封装成 mp4 / webm。
// 画面与预览完全一致（同一个内核、同一套逻辑画幅，只是渲染倍率不同；renderAt 只由 t 决定）。
// 浏览器没有 WebCodecs 时降级为 MediaRecorder：实时播放一遍并录制画布与音频。
import { t } from '@/i18n';
import type { ResolvedAssetClip } from '@/core/assets/clips';
import type { ResolvedBackgroundClip } from '@/core/assets/background';
import {
    AudioBufferSource,
    BufferTarget,
    CanvasSource,
    getFirstEncodableAudioCodec,
    getFirstEncodableVideoCodec,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH,
    QUALITY_MEDIUM,
    QUALITY_VERY_HIGH,
    WebMOutputFormat,
    type AudioCodec,
    type Quality,
    type VideoCodec,
} from 'mediabunny';
import type { LumiProgram } from '@/compiler/types';
import type { AudioAnalysis } from '@/core/audio/analysis';
import type { Line } from '@/core/types';
import type { KernelLook, LumiKernel } from '@/kernel/runtime';

export type ExportFormat = 'mp4' | 'webm';
export type ExportQuality = 'medium' | 'high' | 'very-high';

export interface ExportSettings {
    /** 输出像素尺寸（偶数）。 */
    width: number;
    height: number;
    fps: number;
    format: ExportFormat;
    quality: ExportQuality;
    /** 导出范围（秒）。 */
    start: number;
    end: number;
}

export interface ExportInput {
    program: LumiProgram;
    lines: Line[];
    look: KernelLook;
    analysis: AudioAnalysis | null;
    audio: AudioBuffer | null;
    /** 逻辑画幅（排版坐标系），输出尺寸按比例放大。 */
    logicalWidth: number;
    logicalHeight: number;
    /** 素材层的片段（时间已按编排解析）。 */
    assetClips?: ResolvedAssetClip[];
    /** 背景轨的片段（时间已按编排解析）。 */
    backgroundClips?: ResolvedBackgroundClip[];
}

export interface ExportProgress {
    phase: 'preparing' | 'rendering' | 'finalizing';
    frame: number;
    totalFrames: number;
    /** 已用时间与估计剩余时间（秒）。 */
    elapsed: number;
    remaining: number | null;
}

export interface ExportResult {
    blob: Blob;
    extension: string;
    mimeType: string;
    method: 'webcodecs' | 'mediarecorder';
    videoCodec: string;
    audioCodec: string | null;
}

export const QUALITIES: Record<ExportQuality, Quality> = { medium: QUALITY_MEDIUM, high: QUALITY_HIGH, 'very-high': QUALITY_VERY_HIGH };

const VIDEO_CODECS: Record<ExportFormat, VideoCodec[]> = { mp4: ['avc', 'hevc', 'vp9', 'av1'], webm: ['vp9', 'av1', 'vp8'] };
const AUDIO_CODECS: Record<ExportFormat, AudioCodec[]> = { mp4: ['aac', 'opus'], webm: ['opus', 'vorbis'] };

export const supportsWebCodecs = () => typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';

export class ExportCancelled extends Error {
    constructor() {
        super(t('export:cancelled'));
        this.name = 'ExportCancelled';
    }
}

/** 截取音频的一段（导出范围不是整首时）。 */
export const sliceAudio = (buffer: AudioBuffer, start: number, end: number) => {
    const from = Math.max(0, Math.floor(start * buffer.sampleRate));
    const to = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
    const length = Math.max(1, to - from);
    const sliced = new AudioBuffer({ length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        sliced.copyToChannel(buffer.getChannelData(channel).subarray(from, to), channel);
    }
    return sliced;
};

export const createKernel = async (input: ExportInput, settings: ExportSettings, options: { transparent?: boolean } = {}) => {
    const { LumiKernel } = await import('@/kernel/runtime');
    // 字体没加载完就排版会用回退字体测量，整片的字距都会错。
    if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready;
    const kernel = await LumiKernel.create({
        ...input.look,
        width: input.logicalWidth,
        height: input.logicalHeight,
        resolution: settings.width / input.logicalWidth,
        program: input.program,
        lines: input.lines,
        audio: input.analysis,
        preserveDrawingBuffer: true,
        videoMode: 'exact',
        transparent: options.transparent,
    });
    // 素材与背景的纹理解码完、视频准备好才开始逐帧渲染。
    await Promise.all([kernel.setAssetClips(input.assetClips ?? []), kernel.setBackgroundClips(input.backgroundClips ?? [])]);
    return kernel;
};

export const yieldToUi = () => new Promise(resolve => setTimeout(resolve, 0));

export const exportVideo = async (
    input: ExportInput,
    settings: ExportSettings,
    onProgress: (progress: ExportProgress) => void,
    signal?: AbortSignal,
): Promise<ExportResult> => {
    if (!supportsWebCodecs()) return recordRealtime(input, settings, onProgress, signal);

    const totalFrames = Math.max(1, Math.ceil((settings.end - settings.start) * settings.fps));
    onProgress({ phase: 'preparing', frame: 0, totalFrames, elapsed: 0, remaining: null });
    const quality = QUALITIES[settings.quality];
    const videoCodec = await getFirstEncodableVideoCodec(VIDEO_CODECS[settings.format], {
        width: settings.width, height: settings.height, quality, frameRate: settings.fps,
    });
    if (!videoCodec) throw new Error(t('export:errors.cannotEncode', { width: settings.width, height: settings.height, format: settings.format }));
    const audio = input.audio ? sliceAudio(input.audio, settings.start, settings.end) : null;
    const audioCodec = audio
        ? await getFirstEncodableAudioCodec(AUDIO_CODECS[settings.format], { numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate, quality })
        : null;

    const kernel = await createKernel(input, settings);
    const output = new Output({
        format: settings.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
        target: new BufferTarget(),
    });
    const video = new CanvasSource(kernel.canvas, { codec: videoCodec, quality, keyFrameInterval: 2 });
    output.addVideoTrack(video, { frameRate: settings.fps });
    const audioSource = audio && audioCodec ? new AudioBufferSource({ codec: audioCodec, quality }) : null;
    if (audioSource) output.addAudioTrack(audioSource);

    const onAbort = () => void output.cancel();
    signal?.addEventListener('abort', onAbort, { once: true });
    const startedAt = performance.now();
    try {
        await output.start();
        // 音频一次性交给编码器；视频逐帧追加，两者由封装器交错。
        const audioDone = audioSource && audio ? audioSource.add(audio) : Promise.resolve();
        for (let frame = 0; frame < totalFrames; frame += 1) {
            if (signal?.aborted) throw new ExportCancelled();
            const time = settings.start + frame / settings.fps;
            await kernel.prepareAt(time);
            kernel.renderAt(time);
            await video.add(frame / settings.fps, 1 / settings.fps);
            if (frame % 6 === 0) {
                const elapsed = (performance.now() - startedAt) / 1000;
                const rate = (frame + 1) / Math.max(elapsed, 0.001);
                onProgress({ phase: 'rendering', frame: frame + 1, totalFrames, elapsed, remaining: (totalFrames - frame - 1) / rate });
                await yieldToUi();
            }
        }
        await audioDone;
        if (signal?.aborted) throw new ExportCancelled();
        onProgress({ phase: 'finalizing', frame: totalFrames, totalFrames, elapsed: (performance.now() - startedAt) / 1000, remaining: 0 });
        await output.finalize();
        const buffer = (output.target as BufferTarget).buffer;
        if (!buffer) throw new Error(t('export:errors.noOutput'));
        const mimeType = output.format.mimeType;
        return {
            blob: new Blob([buffer], { type: mimeType }),
            extension: output.format.fileExtension.replace(/^\./, ''),
            mimeType,
            method: 'webcodecs',
            videoCodec,
            audioCodec: audioSource ? audioCodec : null,
        };
    } catch (error) {
        if (signal?.aborted) throw new ExportCancelled();
        await output.cancel().catch(() => undefined);
        throw error;
    } finally {
        signal?.removeEventListener('abort', onAbort);
        kernel.destroy();
    }
};

// ---------------------------------------------------------------------------------------------
// 降级：MediaRecorder 实时录制（没有 WebCodecs 的浏览器）

const pickRecorderMime = () => [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
].find(type => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) ?? '';

const recordRealtime = async (
    input: ExportInput,
    settings: ExportSettings,
    onProgress: (progress: ExportProgress) => void,
    signal?: AbortSignal,
): Promise<ExportResult> => {
    if (typeof MediaRecorder === 'undefined') throw new Error(t('export:errors.noEncoder'));
    const duration = settings.end - settings.start;
    const totalFrames = Math.max(1, Math.ceil(duration * settings.fps));
    const kernel: LumiKernel = await createKernel(input, settings);
    const stream = kernel.canvas.captureStream(settings.fps);
    const context = new AudioContext();
    let source: AudioBufferSourceNode | null = null;
    if (input.audio) {
        const destination = context.createMediaStreamDestination();
        source = context.createBufferSource();
        source.buffer = input.audio;
        source.connect(destination);
        destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    }
    const mimeType = pickRecorderMime();
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: settings.width * settings.height * settings.fps * 0.12 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => {
        if (event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });

    try {
        kernel.renderAt(settings.start);
        recorder.start(1000);
        const startAt = context.currentTime + 0.1;
        source?.start(startAt, settings.start, duration);
        await new Promise<void>((resolve, reject) => {
            const tick = () => {
                if (signal?.aborted) {
                    reject(new ExportCancelled());
                    return;
                }
                const elapsed = Math.max(0, context.currentTime - startAt);
                const time = settings.start + Math.min(elapsed, duration);
                // 实时录制时背景视频的帧晚一拍解码（兜底路径，精度让位于不卡住录制）。
                void kernel.prepareAt(time);
                kernel.renderAt(time);
                onProgress({
                    phase: 'rendering',
                    frame: Math.min(totalFrames, Math.round(elapsed * settings.fps)),
                    totalFrames,
                    elapsed,
                    remaining: Math.max(0, duration - elapsed),
                });
                if (elapsed >= duration) resolve();
                else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
        onProgress({ phase: 'finalizing', frame: totalFrames, totalFrames, elapsed: duration, remaining: 0 });
        recorder.stop();
        await stopped;
        const type = recorder.mimeType || mimeType || 'video/webm';
        return {
            blob: new Blob(chunks, { type }),
            extension: type.includes('mp4') ? 'mp4' : 'webm',
            mimeType: type,
            method: 'mediarecorder',
            videoCodec: type,
            audioCodec: input.audio ? 'opus' : null,
        };
    } finally {
        if (recorder.state !== 'inactive') recorder.stop();
        source?.stop();
        void context.close();
        stream.getTracks().forEach(track => track.stop());
        kernel.destroy();
    }
};
