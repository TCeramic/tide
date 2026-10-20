// src/app/library/StyleThumb.tsx
// 一个风格的缩略图（进入视口才生成）。风格库、检查器、快速选择共用。
// 鼠标停在上面（或 active，例如快速选择里键盘高亮的那一项）时循环播放这个风格的示例段落。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StyleId } from '@/compiler/types';
import { renderTheme } from '@/project/defaults';
import { useProjectStore } from '@/project/store';
import { playThumbnailMotion, requestThumbnail, type ThumbnailLook } from './thumbnails';

/** 划过一排卡片时不必每张都起播：停留这么久才开始。 */
const HOVER_DELAY = 150;

/** 缩略图用的观感：当前主题（含字体）与 tuning。 */
export const useThumbnailLook = (): ThumbnailLook => {
    const project = useProjectStore(state => state.project);
    const theme = renderTheme(project);
    const themeKey = JSON.stringify(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => ({ theme, tunings: project.tuning }), [themeKey, project.tuning]);
};

export function StyleThumb({ style, look, className, active = false }: { style: string; look: ThumbnailLook; className?: string; active?: boolean }) {
    const [url, setUrl] = useState<string | null>(null);
    const [visible, setVisible] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [playing, setPlaying] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wantMotion = active || hovered;

    useEffect(() => {
        if (!wantMotion) return;
        let stop: (() => void) | null = null;
        const timer = window.setTimeout(() => {
            if (!canvasRef.current) return;
            stop = playThumbnailMotion(style as StyleId, look, canvasRef.current);
            setPlaying(true);
        }, active ? 0 : HOVER_DELAY);
        return () => {
            window.clearTimeout(timer);
            stop?.();
            setPlaying(false);
        };
    }, [wantMotion, active, style, look]);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '200px' });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!visible) return;
        return requestThumbnail(style, look, setUrl);
    }, [visible, style, look]);

    return (
        <div
            ref={ref}
            data-style-thumb={style}
            data-playing={playing || undefined}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            className={`relative ${className ?? 'aspect-video w-full bg-zinc-950'}`}
        >
            {url && <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />}
            {wantMotion && <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full object-cover ${playing ? '' : 'invisible'}`} />}
        </div>
    );
}
