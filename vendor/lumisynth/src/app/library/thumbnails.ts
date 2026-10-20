// src/app/library/thumbnails.ts
// 风格缩略图：一个离屏内核，按需给每个风格渲染一帧。示例歌词固定、该风格锁定在每个 shot 上，
// 取字已落位的时刻，所以缩略图只随主题变化。生成排队进行，每张之间让出主线程。
// 悬停预览：另一个离屏内核，把示例段落从头到尾循环播放，逐帧画到悬停的那张卡片上（同一时刻只有一张）。
import { compileLumiProgram } from '@/compiler/compile';
import type { EditOp, StyleId } from '@/compiler/types';
import { splitStyleId } from '@/compiler/types';
import { anchorOfLine } from '@/core/lyrics/edits';
import type { Line, Theme } from '@/core/types';
import type { LumiKernel } from '@/kernel/runtime';
import type { KernelTunings } from '@/kernel/adapters/types';

const words = (text: string, start: number, step: number) => Array.from(text).map((char, index) => ({
    text: char,
    startTime: start + index * step,
    endTime: start + (index + 1) * step,
}));

const SAMPLE_LINES: Line[] = [
    { startTime: 0.2, endTime: 3.4, fullText: '光と影のあいだで', words: words('光と影のあいだで', 0.2, 0.4) },
];

export interface ThumbnailLook {
    theme: Theme;
    tunings: KernelTunings;
}

const cache = new Map<string, string>();
const listeners = new Map<string, Set<(url: string) => void>>();
const queue: Array<{ key: string; style: StyleId; look: ThumbnailLook }> = [];
let running = false;

const lookKey = (look: ThumbnailLook) => JSON.stringify([look.theme, look.tunings.packs]);

/** 锁定在示例歌词的每个 slot 上（包各自怎么切块不重要，用不上的 slot 会被忽略）。 */
const forcedOps = (style: StyleId): EditOp[] => {
    const anchor = anchorOfLine(SAMPLE_LINES[0], 0);
    const slots = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];
    return slots.map(slot => ({ id: `thumb-${slot}`, type: 'shot-style' as const, anchor: { line: anchor, slot }, style }));
};

const programFor = (style: StyleId, look: ThumbnailLook) => compileLumiProgram({
    lines: SAMPLE_LINES,
    seed: 'thumbnail',
    direction: { mode: 'single', pack: splitStyleId(style).pack, mixByKind: {}, shotMixing: false },
    overrides: forcedOps(style),
    packTunings: look.tunings.packs,
});

const kernelLookOf = (look: ThumbnailLook) => ({
    theme: look.theme,
    tunings: { ...look.tunings, kernel: { ...look.tunings.kernel, subtitles: { ...look.tunings.kernel.subtitles, mode: 'none' as const } } },
    metadata: { title: null, artist: null, album: null },
    coverColors: [],
    cover: null,
    layerImages: new Map(),
});

/** 一个离屏内核（缩略图、悬停预览各一个）：按需创建，观感变了就 setLook。 */
const thumbnailKernel = (resolution: number) => {
    let created: Promise<LumiKernel> | null = null;
    let key = '';
    return async (look: ThumbnailLook, program: ReturnType<typeof programFor>) => {
        const nextKey = lookKey(look);
        // 第一次调用还没建好时又来一次（悬停很快地换卡片）：等同一个，不建第二个。
        const fresh = !created;
        created ??= import('@/kernel/runtime').then(({ LumiKernel }) => LumiKernel.create({
            ...kernelLookOf(look),
            width: 1280,
            height: 720,
            resolution,
            program,
            lines: SAMPLE_LINES,
            audio: null,
            preserveDrawingBuffer: true,
        })).catch(error => {
            created = null;
            throw error;
        });
        const kernel = await created;
        if (fresh) {
            key = nextKey;
        } else if (nextKey !== key) {
            key = nextKey;
            await kernel.setLook(kernelLookOf(look));
        }
        kernel.setProgram(program, SAMPLE_LINES);
        return kernel;
    };
};

const stillKernel = thumbnailKernel(0.25);

const renderOne = async (style: StyleId, look: ThumbnailLook): Promise<string> => {
    const program = programFor(style, look);
    const kernel = await stillKernel(look, program);
    // 取第一个镜头里字已经落位、还没开始交接出场的时刻。
    const shot = program.paragraphs[0]?.shots[0];
    const time = shot ? Math.max(shot.startTime, Math.min(shot.endTime - 0.1, shot.lyricEndTime + 0.6)) : 2.8;
    kernel.renderAt(time);
    return kernel.canvas.toDataURL('image/jpeg', 0.82);
};

const pump = async () => {
    if (running) return;
    running = true;
    try {
        while (queue.length > 0) {
            const job = queue.shift()!;
            if (cache.has(job.key)) continue;
            try {
                const url = await renderOne(job.style, job.look);
                cache.set(job.key, url);
                listeners.get(job.key)?.forEach(listener => listener(url));
            } catch (error) {
                console.warn('thumbnail failed', job.style, error);
            }
            // 每张之间让出主线程，保证编辑器操作不卡。
            await new Promise(resolve => setTimeout(resolve, 16));
        }
    } finally {
        running = false;
    }
};

/** 取缩略图；还没有时排队生成，生成后回调。返回取消订阅函数。 */
export const requestThumbnail = (style: StyleId, look: ThumbnailLook, onReady: (url: string) => void) => {
    const key = `${style}|${lookKey(look)}`;
    const cached = cache.get(key);
    if (cached) {
        onReady(cached);
        return () => undefined;
    }
    let set = listeners.get(key);
    if (!set) listeners.set(key, set = new Set());
    set.add(onReady);
    if (!queue.some(job => job.key === key)) queue.push({ key, style, look });
    void pump();
    return () => {
        set!.delete(onReady);
        // 已经滚出视野、没人等的任务不再生成。
        if (set!.size === 0) {
            const index = queue.findIndex(job => job.key === key);
            if (index >= 0) queue.splice(index, 1);
        }
    };
};

const motionKernel = thumbnailKernel(0.35);
/** 当前在播的悬停预览；开始新的一张会让旧的停下。 */
let motionToken = 0;
/** 段落播完之后停一下再从头开始。 */
const LOOP_HOLD = 0.5;

/**
 * 在 canvas 上循环播放这个风格的示例段落。返回停止函数。
 * 内核渲染只由时刻决定，所以每一轮都完全一样。
 */
export const playThumbnailMotion = (style: StyleId, look: ThumbnailLook, canvas: HTMLCanvasElement) => {
    const token = ++motionToken;
    let frame = 0;
    const alive = () => token === motionToken;
    void (async () => {
        const program = programFor(style, look);
        const kernel = await motionKernel(look, program);
        if (!alive()) return;
        const paragraph = program.paragraphs[0];
        const end = paragraph ? paragraph.endTime : 3.8;
        const span = end + LOOP_HOLD;
        canvas.width = kernel.canvas.width;
        canvas.height = kernel.canvas.height;
        const context = canvas.getContext('2d');
        if (!context) return;
        const started = performance.now();
        const draw = () => {
            if (!alive()) return;
            const elapsed = ((performance.now() - started) / 1000) % span;
            kernel.renderAt(Math.min(elapsed, end));
            context.drawImage(kernel.canvas, 0, 0, canvas.width, canvas.height);
            frame = requestAnimationFrame(draw);
        };
        draw();
    })().catch(error => console.warn('thumbnail motion failed', style, error));
    return () => {
        if (alive()) motionToken += 1;
        cancelAnimationFrame(frame);
    };
};
