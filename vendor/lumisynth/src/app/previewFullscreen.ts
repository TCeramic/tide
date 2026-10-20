// src/app/previewFullscreen.ts
// 预览全屏：让预览区域本身进入浏览器全屏（Esc 由浏览器退出）。预览组件挂载时登记自己的容器。
import { useSyncExternalStore } from 'react';

let target: HTMLElement | null = null;

export const setPreviewFullscreenTarget = (element: HTMLElement | null) => {
    target = element;
};

export const isPreviewFullscreen = () => Boolean(target) && document.fullscreenElement === target;

export const togglePreviewFullscreen = () => {
    if (document.fullscreenElement) {
        void document.exitFullscreen();
        return;
    }
    void target?.requestFullscreen().catch(() => undefined);
};

const subscribe = (onChange: () => void) => {
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
};

export const usePreviewFullscreen = () => useSyncExternalStore(subscribe, isPreviewFullscreen);
