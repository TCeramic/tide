// src/app/theme-park/useThemeDraftPreview.ts
// 预览用的工程：主题编辑器开着时，把主题换成（清洗过的）草稿，显示正在编辑的那一面（深 / 浅）。
// 拖取色器时草稿每秒变几十次，而换主题要重建场景：这里最多每 PREVIEW_INTERVAL 毫秒跟一次，最后一次一定会跟上。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DualTheme } from '@/core/types';
import type { LumiProject } from '@/project/types';
import { normalizeThemeDraft, type EditableMode } from './themeParkDraft';
import { useThemePark } from './themeParkStore';

const PREVIEW_INTERVAL = 90;

const useThrottled = <T,>(value: T, interval: number) => {
    const [throttled, setThrottled] = useState(value);
    const last = useRef(0);
    useEffect(() => {
        const wait = interval - (performance.now() - last.current);
        if (wait <= 0) {
            last.current = performance.now();
            setThrottled(value);
            return;
        }
        const timer = window.setTimeout(() => {
            last.current = performance.now();
            setThrottled(value);
        }, wait);
        return () => window.clearTimeout(timer);
    }, [value, interval]);
    return throttled;
};

export const useThemeDraftPreview = (project: LumiProject): LumiProject => {
    const draft = useThemePark(state => state.draft);
    const mode = useThemePark(state => state.mode);
    const throttled = useThrottled<{ draft: DualTheme | null; mode: EditableMode }>(useMemo(() => ({ draft, mode }), [draft, mode]), PREVIEW_INTERVAL);
    // 清洗结果只随草稿变：工程别处改了（歌词、编排）不能让主题换成新对象——那会让预览重建所有场景。
    const baseDual = project.theme.dual;
    const dual = useMemo(() => (throttled.draft ? normalizeThemeDraft(throttled.draft, baseDual) : null), [throttled.draft, baseDual]);
    return useMemo(() => (dual
        ? { ...project, theme: { ...project.theme, variant: throttled.mode, dual } }
        : project), [project, dual, throttled.mode]);
};
