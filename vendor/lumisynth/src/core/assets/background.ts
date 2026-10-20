// src/core/assets/background.ts
// 自定义背景轨：叠在「默认背景」（主题色 / 封面，见内核的背景设置）之上的一串片段。
// 片段之间的空档露出默认背景；片段各自淡入淡出，相邻片段首尾重叠就是交叉淡化。
// 视频背景：片段内的第 t 秒对应视频的 offset + t 秒（可循环），声音不进成片。
import type { LumiProgram } from '@/compiler/types';
import { resolveClipRange, type ClipTiming } from './clips';

export type BackgroundSource =
    | { type: 'theme' }
    | { type: 'gradient'; from: string; to: string; angle: number }
    | { type: 'cover' }
    | { type: 'image'; assetId: string }
    | { type: 'video'; assetId: string; offset: number; loop: boolean };

export interface BackgroundClip {
    id: string;
    source: BackgroundSource;
    timing: ClipTiming;
    /** cover 铺满（裁切），contain 完整显示（留边露出下面）。 */
    fit: 'cover' | 'contain';
    /** 片段内缓慢推近的幅度（0 = 不动，0.1 = 放大 10%）。 */
    kenBurns: number;
    /** 模糊（像素，按 1080p 计）。 */
    blur: number;
    /** 压暗（叠一层主题背景色的不透明度）。 */
    dim: number;
    fadeIn: number;
    fadeOut: number;
}

export interface ResolvedBackgroundClip extends BackgroundClip {
    start: number;
    end: number;
}

export const DEFAULT_BACKGROUND_LOOK: Omit<BackgroundClip, 'id' | 'source' | 'timing'> = {
    fit: 'cover',
    kenBurns: 0.06,
    blur: 0,
    dim: 0.25,
    fadeIn: 0.6,
    fadeOut: 0.6,
};

export const backgroundAssetId = (source: BackgroundSource) => (source.type === 'image' || source.type === 'video' ? source.assetId : null);

export interface BackgroundResolution {
    resolved: ResolvedBackgroundClip[];
    invalid: Array<{ clip: BackgroundClip; reason: 'anchor-missing' | 'asset-missing' }>;
}

export const resolveBackgroundClips = (clips: BackgroundClip[], program: LumiProgram, assetIds: Set<string>): BackgroundResolution => {
    const resolved: ResolvedBackgroundClip[] = [];
    const invalid: BackgroundResolution['invalid'] = [];
    clips.forEach(clip => {
        const assetId = backgroundAssetId(clip.source);
        if (assetId && !assetIds.has(assetId)) {
            invalid.push({ clip, reason: 'asset-missing' });
            return;
        }
        const range = resolveClipRange(clip.timing, program);
        if (!range) {
            invalid.push({ clip, reason: 'anchor-missing' });
            return;
        }
        resolved.push({ ...clip, start: range.start, end: Math.max(range.start + 0.05, range.end) });
    });
    return { resolved, invalid };
};

export interface BackgroundFrame {
    visible: boolean;
    alpha: number;
    /** Ken Burns 推近后的缩放倍数。 */
    zoom: number;
    /** 视频片段对应的视频时间（秒）；不是视频时为 null。 */
    videoTime: number | null;
}

const HIDDEN: BackgroundFrame = { visible: false, alpha: 0, zoom: 1, videoTime: null };
const smooth = (value: number) => value * value * (3 - 2 * value);

/** 片段在时刻 time 的状态（纯函数）。 */
export const evaluateBackground = (clip: ResolvedBackgroundClip, time: number, videoDuration?: number): BackgroundFrame => {
    if (time < clip.start || time >= clip.end) return HIDDEN;
    const length = clip.end - clip.start;
    const local = time - clip.start;
    const fadeIn = Math.min(clip.fadeIn, length / 2);
    const fadeOut = Math.min(clip.fadeOut, length / 2);
    let alpha = 1;
    if (fadeIn > 0 && local < fadeIn) alpha = smooth(local / fadeIn);
    else if (fadeOut > 0 && clip.end - time < fadeOut) alpha = smooth((clip.end - time) / fadeOut);
    // 全曲片段没有真实的结束，推近按 60 秒一个周期走完。
    const span = Math.min(length, 60);
    const zoom = 1 + clip.kenBurns * smooth(Math.min(1, local / Math.max(span, 0.001)));
    let videoTime: number | null = null;
    if (clip.source.type === 'video') {
        const raw = clip.source.offset + local;
        videoTime = videoDuration && videoDuration > 0
            ? (clip.source.loop ? raw % videoDuration : Math.min(raw, Math.max(0, videoDuration - 0.001)))
            : raw;
    }
    return { visible: alpha > 0.001, alpha, zoom, videoTime };
};
