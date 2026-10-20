// src/kernel/videoSource.ts
// 背景视频的画面来源：把视频某一时刻的帧画到一张画布上，内核拿这张画布当纹理。两种模式：
// - realtime（预览）：<video> 元素跟随播放时钟，播放时允许少量漂移，暂停 / 拖动时精确定位；
// - exact（导出）：用 mediabunny 按时间解码出那一帧，逐帧导出与时间严格对应。
// 声音一律不要：<video> 静音，解码只取视频轨。

export interface KernelVideoSource {
    readonly canvas: HTMLCanvasElement;
    /** 视频时长（秒），准备好之后才有意义。 */
    readonly duration: number;
    readonly ready: Promise<void>;
    /** realtime：跟随时钟并把当前帧画到画布上（同步，可能落后一两帧）。 */
    sync(videoTime: number, playing: boolean): void;
    /** exact：解码 videoTime 那一帧并画到画布上。realtime 模式下等价于 sync + 等到定位完成。 */
    prepare(videoTime: number): Promise<void>;
    destroy(): void;
}

const MAX_WIDTH = 1920;

/**
 * 歌曲时间换算成视频时间（取模、减偏移）时的浮点误差，以及容器把时间戳取整到毫秒（WebM），
 * 都会让请求的时间落在帧的时间戳前一点点，解码器于是返回上一帧——成片里重复一帧、跳过一帧。
 * 往后挪 1 毫秒（远小于任何帧长）。
 */
const FRAME_NUDGE = 1e-3;

const makeCanvas = (width: number, height: number) => {
    const scale = Math.min(1, MAX_WIDTH / Math.max(1, width));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(width * scale));
    canvas.height = Math.max(2, Math.round(height * scale));
    return canvas;
};

/** 预览：<video> 元素。onFrame 在暂停状态下定位完成、画面更新时调用（让内核重画一帧）。 */
export const createRealtimeVideoSource = (blob: Blob, onFrame: () => void): KernelVideoSource => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    let canvas = makeCanvas(16, 9);
    let context = canvas.getContext('2d')!;
    let destroyed = false;
    const draw = () => {
        if (destroyed || video.readyState < 2) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
    };
    const ready = new Promise<void>(resolve => {
        const done = () => {
            canvas = makeCanvas(video.videoWidth || 16, video.videoHeight || 9);
            context = canvas.getContext('2d')!;
            draw();
            resolve();
        };
        video.addEventListener('loadeddata', done, { once: true });
        video.addEventListener('error', () => resolve(), { once: true });
    });
    video.addEventListener('seeked', () => {
        draw();
        if (video.paused) onFrame();
    });
    return {
        get canvas() { return canvas; },
        get duration() { return Number.isFinite(video.duration) ? video.duration : 0; },
        ready,
        sync(target, playing) {
            if (destroyed || video.readyState < 1) return;
            const videoTime = target + FRAME_NUDGE;
            if (playing) {
                if (video.paused) void video.play().catch(() => undefined);
                if (Math.abs(video.currentTime - videoTime) > 0.25) video.currentTime = videoTime;
            } else {
                if (!video.paused) video.pause();
                if (Math.abs(video.currentTime - videoTime) > 0.02 && !video.seeking) video.currentTime = videoTime;
            }
            draw();
        },
        async prepare(target) {
            await ready;
            const videoTime = target + FRAME_NUDGE;
            if (Math.abs(video.currentTime - videoTime) > 0.02) {
                await new Promise<void>(resolve => {
                    video.addEventListener('seeked', () => resolve(), { once: true });
                    video.currentTime = videoTime;
                });
            }
            draw();
        },
        destroy() {
            destroyed = true;
            video.pause();
            video.removeAttribute('src');
            video.load();
            URL.revokeObjectURL(url);
        },
    };
};

/** 导出：用 mediabunny 精确解码。 */
export const createExactVideoSource = (blob: Blob): KernelVideoSource => {
    let canvas = makeCanvas(16, 9);
    let context = canvas.getContext('2d')!;
    let duration = 0;
    let sink: import('mediabunny').CanvasSink | null = null;
    let input: import('mediabunny').Input | null = null;
    let lastTime = Number.NaN;
    const ready = (async () => {
        const { ALL_FORMATS, BlobSource, CanvasSink, Input } = await import('mediabunny');
        input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track) return;
        duration = await input.computeDuration();
        canvas = makeCanvas(track.displayWidth, track.displayHeight);
        context = canvas.getContext('2d')!;
        sink = new CanvasSink(track, { width: canvas.width, height: canvas.height, fit: 'fill' });
    })().catch(() => undefined);
    return {
        get canvas() { return canvas; },
        get duration() { return duration; },
        ready,
        sync() {
            // 导出不走实时同步。
        },
        async prepare(videoTime) {
            await ready;
            if (!sink || videoTime === lastTime) return;
            lastTime = videoTime;
            const wrapped = await sink.getCanvas(Math.max(0, videoTime) + FRAME_NUDGE);
            if (wrapped) context.drawImage(wrapped.canvas as CanvasImageSource, 0, 0, canvas.width, canvas.height);
        },
        destroy() {
            sink = null;
            input?.dispose?.();
            input = null;
        },
    };
};
