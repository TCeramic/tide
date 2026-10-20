// src/app/FullscreenControls.tsx
// 预览全屏时叠在画面底部的迷你走带：播放 / 暂停、进度、时间、退出全屏。鼠标停住一会儿就隐藏（连同光标）。
import { useEffect, useState, type RefObject } from 'react';
import { Minimize2, Pause, Play } from 'lucide-react';
import { seek, togglePlay, usePlayback } from './playback';
import { togglePreviewFullscreen } from './previewFullscreen';
import { formatTime } from './Transport';
import { rangeFill } from './ui';
import { useTranslation } from 'react-i18next';

const IDLE_MS = 2500;

export function FullscreenControls({ container }: { container: RefObject<HTMLDivElement | null> }) {
    const playing = usePlayback(state => state.playing);
    const time = usePlayback(state => state.time);
    const duration = usePlayback(state => state.duration);
    const [awake, setAwake] = useState(true);
    const { t } = useTranslation(['workbench', 'common']);

    useEffect(() => {
        const element = container.current;
        if (!element) return;
        let timer = window.setTimeout(() => setAwake(false), IDLE_MS);
        const wake = () => {
            setAwake(true);
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setAwake(false), IDLE_MS);
        };
        element.addEventListener('pointermove', wake);
        element.addEventListener('pointerdown', wake);
        window.addEventListener('keydown', wake);
        return () => {
            window.clearTimeout(timer);
            element.removeEventListener('pointermove', wake);
            element.removeEventListener('pointerdown', wake);
            window.removeEventListener('keydown', wake);
        };
    }, [container]);

    // 停住时连光标一起藏起来（画面上不留箭头）。
    useEffect(() => {
        const element = container.current;
        if (!element) return;
        element.style.cursor = awake ? '' : 'none';
        return () => { element.style.cursor = ''; };
    }, [awake, container]);

    return (
        <div
            data-testid="fullscreen-controls"
            className={`absolute inset-x-0 bottom-0 z-30 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-5 pt-10 pb-4 transition-opacity duration-300 ${awake ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
            <button type="button" onClick={togglePlay} aria-label={playing ? t('common:pause') : t('common:play')} className="rounded p-1.5 text-zinc-100 hover:bg-white/10">
                {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <input
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={Math.min(time, duration)}
                onChange={event => seek(Number(event.target.value))}
                aria-label={t('fullscreen.progress')}
                style={rangeFill(Math.min(time, duration), 0, duration)}
                className="min-w-0 flex-1"
            />
            <span className="w-32 text-right text-xs text-zinc-300 tabular-nums">{formatTime(time)} / {formatTime(duration)}</span>
            <button type="button" onClick={togglePreviewFullscreen} aria-label={t('fullscreen.exit')} title={t('fullscreen.exitHint')} className="rounded p-1.5 text-zinc-100 hover:bg-white/10">
                <Minimize2 size={16} />
            </button>
        </div>
    );
}
