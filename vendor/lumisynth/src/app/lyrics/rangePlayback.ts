// src/app/lyrics/rangePlayback.ts
// 只播一段（一行、一个字）：从 start 播到 end 停下，loop 时回到 start 再播。用 rAF 盯着时钟，
// 手动暂停或拖动播放头到这一段外面就结束。
import { create } from 'zustand';
import { clock, pause, play, seek } from '../playback';

interface RangeState {
    range: { start: number; end: number; loop: boolean } | null;
}

export const useRangePlayback = create<RangeState>(() => ({ range: null }));

let frame = 0;

const watch = () => {
    cancelAnimationFrame(frame);
    const tick = () => {
        const range = useRangePlayback.getState().range;
        if (!range) return;
        if (clock.paused) {
            useRangePlayback.setState({ range: null });
            return;
        }
        const time = clock.get();
        if (time < range.start - 0.5) {
            // 播放头被拖走了。
            useRangePlayback.setState({ range: null });
            return;
        }
        if (time >= range.end) {
            if (range.loop) {
                seek(range.start);
            } else {
                pause();
                useRangePlayback.setState({ range: null });
                return;
            }
        }
        frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
};

export const playRange = (start: number, end: number, loop = false) => {
    useRangePlayback.setState({ range: { start: Math.max(0, start), end, loop } });
    seek(Math.max(0, start));
    play();
    watch();
};

export const stopRange = () => {
    if (!useRangePlayback.getState().range) return;
    useRangePlayback.setState({ range: null });
    cancelAnimationFrame(frame);
    pause();
};

export const setRangeLoop = (loop: boolean) => {
    const range = useRangePlayback.getState().range;
    if (range) useRangePlayback.setState({ range: { ...range, loop } });
};
