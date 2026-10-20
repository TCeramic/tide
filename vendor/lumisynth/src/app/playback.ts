// src/app/playback.ts
// 预览的播放状态。时钟是单例：runtime、时间轴、走带都读同一个。
import { create } from 'zustand';
import { HostClock } from '@/host/clock';
import { setLayout, useLayout } from './workbench/layout';

export const clock = new HostClock();

// 预览音量存在布局偏好里（每个浏览器自己的），时钟跟着它走。
const applyVolume = ({ previewVolume, previewMuted }: { previewVolume: number; previewMuted: boolean }) => clock.setVolume(previewVolume, previewMuted);
applyVolume(useLayout.getState());
useLayout.subscribe(applyVolume);

/** 调音量；拖到 0 等于静音，从静音里调大自动取消静音。 */
export const setPreviewVolume = (volume: number) => {
    const clamped = Math.min(1, Math.max(0, volume));
    setLayout({ previewVolume: clamped, previewMuted: clamped === 0 });
};

export const togglePreviewMute = () => {
    const { previewMuted, previewVolume } = useLayout.getState();
    // 音量是 0 时取消静音没有意义：恢复到一个听得见的音量。
    if (previewMuted && previewVolume === 0) setLayout({ previewMuted: false, previewVolume: 0.5 });
    else setLayout({ previewMuted: !previewMuted });
};

interface PlaybackState {
    playing: boolean;
    /** UI 显示用的时间，每帧同步；runtime 直接读 clock。 */
    time: number;
    duration: number;
    /** 试听速度（1 = 正常）。 */
    rate: number;
}

export const usePlayback = create<PlaybackState>(() => ({ playing: false, time: 0, duration: 0, rate: 1 }));

export const setPlaybackRate = (rate: number) => {
    clock.setRate(rate);
    usePlayback.setState({ rate });
};

type RenderListener = () => void;
const pausedSeekListeners = new Set<RenderListener>();

/** 暂停时 seek 需要 runtime 手动渲染一帧；runtime 在这里登记。 */
export const onPausedSeek = (listener: RenderListener) => {
    pausedSeekListeners.add(listener);
    return () => {
        pausedSeekListeners.delete(listener);
    };
};

export const seek = (time: number) => {
    const clamped = Math.max(0, time);
    clock.seek(clamped);
    usePlayback.setState({ time: clamped });
    if (clock.paused) pausedSeekListeners.forEach(listener => listener());
};

export const play = () => {
    clock.play();
    usePlayback.setState({ playing: !clock.paused });
};

export const pause = () => {
    clock.pause();
    usePlayback.setState({ playing: false });
};

export const togglePlay = () => (clock.paused ? play() : pause());

export const syncPlaying = () => usePlayback.setState({ playing: !clock.paused });
