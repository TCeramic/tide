import { useEffect, useRef } from 'react';
import { Maximize2, Pause, Play, SkipBack, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useSession } from '@/project/session';
import { useEffectiveLyrics } from './DerivedProvider';
import { clock, seek, setPreviewVolume, togglePlay, togglePreviewMute, usePlayback } from './playback';
import { togglePreviewFullscreen } from './previewFullscreen';
import { Button, rangeFill } from './ui';
import { useLayout } from './workbench/layout';
import { useTranslation } from 'react-i18next';

export const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds)) return '0:00.0';
    const m = Math.floor(seconds / 60);
    const s = seconds - m * 60;
    return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

/** 工程总时长：有音频用音频时长，否则用歌词末尾再留 4 秒。 */
export const useProjectDuration = () => {
    const audioDuration = useSession(state => state.audioBuffer?.duration ?? null);
    const { data } = useEffectiveLyrics();
    const lyricsEnd = data?.lines.at(-1)?.endTime ?? 0;
    return audioDuration ?? (lyricsEnd > 0 ? lyricsEnd + 4 : 60 * 8);
};

/** 预览音量：喇叭点一下静音，滑条调音量（滚轮每格 5%）。 */
function VolumeControl() {
    const volume = useLayout(state => state.previewVolume);
    const muted = useLayout(state => state.previewMuted);
    const sliderRef = useRef<HTMLInputElement>(null);
    const { t } = useTranslation('song');
    const silent = muted || volume === 0;
    const Icon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

    useEffect(() => {
        const slider = sliderRef.current;
        if (!slider) return;
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
            const { previewVolume, previewMuted } = useLayout.getState();
            const current = previewMuted ? 0 : previewVolume;
            setPreviewVolume(Math.round((current + (delta > 0 ? -0.05 : 0.05)) * 20) / 20);
        };
        slider.addEventListener('wheel', onWheel, { passive: false });
        return () => slider.removeEventListener('wheel', onWheel);
    }, []);

    return (
        <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={togglePreviewMute} aria-label={silent ? t('transport.unmute') : t('transport.mute')} title={`${silent ? t('transport.unmute') : t('transport.mute')} (M)`}>
                <Icon size={15} />
            </Button>
            <input
                ref={sliderRef}
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={silent ? 0 : volume}
                onChange={event => setPreviewVolume(Number(event.target.value))}
                aria-label={t('transport.volume')}
                title={t('transport.volumeHint', { percent: Math.round((silent ? 0 : volume) * 100) })}
                style={rangeFill(silent ? 0 : volume, 0, 1)}
                className="w-20"
            />
        </div>
    );
}

export function Transport() {
    const playing = usePlayback(state => state.playing);
    const time = usePlayback(state => state.time);
    const duration = useProjectDuration();
    const sliderRef = useRef<HTMLInputElement>(null);
    const { t } = useTranslation(['song', 'common']);

    // 滚轮在进度条上前后移动：每格 1 秒，按住 Shift 为 1 帧。原生监听器才能阻止页面滚动。
    useEffect(() => {
        const slider = sliderRef.current;
        if (!slider) return;
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
            const step = event.shiftKey ? 1 / 30 : 1;
            seek(Math.min(duration, Math.max(0, clock.get() + (delta > 0 ? step : -step))));
        };
        slider.addEventListener('wheel', onWheel, { passive: false });
        return () => slider.removeEventListener('wheel', onWheel);
    }, [duration]);

    useEffect(() => {
        usePlayback.setState({ duration });
    }, [duration]);

    // 每帧把时钟同步到 UI；无音频时手动时钟播到结尾自动停。
    useEffect(() => {
        let frame = 0;
        const tick = () => {
            const now = clock.get();
            if (!clock.paused && now >= duration) {
                clock.pause();
                clock.seek(duration);
                usePlayback.setState({ playing: false });
            }
            usePlayback.setState({ time: clock.get() });
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [duration]);

    return (
        <div className="flex h-11 shrink-0 items-center gap-3 border-t border-zinc-800 bg-zinc-900 px-3">
            <Button variant="ghost" size="sm" onClick={() => seek(0)} aria-label={t('transport.toStart')}>
                <SkipBack size={15} />
            </Button>
            <Button variant="ghost" size="sm" onClick={togglePlay} aria-label={playing ? t('common:pause') : t('common:play')}>
                {playing ? <Pause size={16} /> : <Play size={16} />}
            </Button>
            <input
                ref={sliderRef}
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={Math.min(time, duration)}
                onChange={event => seek(Number(event.target.value))}
                aria-label={t('transport.progress')}
                title={t('transport.progressHint')}
                style={rangeFill(Math.min(time, duration), 0, duration)}
                className="min-w-0 flex-1"
            />
            <span className="w-32 shrink-0 whitespace-nowrap text-right text-xs text-zinc-400 tabular-nums">
                {formatTime(time)} / {formatTime(duration)}
            </span>
            <VolumeControl />
            <Button variant="ghost" size="sm" onClick={togglePreviewFullscreen} aria-label={t('transport.fullscreen')} title={`${t('transport.fullscreen')} (F)`}>
                <Maximize2 size={15} />
            </Button>
        </div>
    );
}
