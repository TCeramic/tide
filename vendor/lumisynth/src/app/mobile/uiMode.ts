// src/app/mobile/uiMode.ts
// 用桌面（VS Code 式工作台）还是移动布局：auto 时窄屏（< 768px）或「触控为主且不太宽」的设备用移动布局。
import { useSyncExternalStore } from 'react';
import { useLayout } from '../workbench/layout';

const QUERY = '(max-width: 767px), (pointer: coarse) and (max-width: 1024px)';

const subscribe = (onChange: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
    const media = window.matchMedia(QUERY);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
};

const prefersMobile = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(QUERY).matches);

export const useIsMobileLayout = () => {
    const mode = useLayout(state => state.uiMode);
    const auto = useSyncExternalStore(subscribe, prefersMobile, () => false);
    return mode === 'mobile' || (mode === 'auto' && auto);
};

export const isMobileLayoutNow = () => {
    const mode = useLayout.getState().uiMode;
    return mode === 'mobile' || (mode === 'auto' && prefersMobile());
};

const COARSE = '(pointer: coarse)';
const subscribeCoarse = (onChange: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
    const media = window.matchMedia(COARSE);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
};

/** 触控为主的设备：点击目标放大到 40px 以上。 */
export const useCoarsePointer = () => useSyncExternalStore(
    subscribeCoarse,
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(COARSE).matches),
    () => false,
);
