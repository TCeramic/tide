// src/app/backgroundActions.ts
// 背景轨的常用操作与文字：时间轴、检查器、素材库、「画面与编排」共用。
import type { BackgroundClip, BackgroundSource, ResolvedBackgroundClip } from '@/core/assets/background';
import type { ClipTiming } from '@/core/assets/clips';
import { getAgentState } from '@/agent/host';
import { addBackgroundClip, moveBackgroundClip, removeBackgroundClip, updateBackgroundClip } from '@/project/assets';
import { setSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { locateAt } from './arrangeActions';
import { timingLabel } from './clipActions';
import { clock, seek } from './playback';
import type { ContextMenuItem } from './workbench/ContextMenu';
import { t } from '@/i18n';

export const BACKGROUND_SOURCES: BackgroundSource['type'][] = ['theme', 'gradient', 'cover', 'image', 'video'];

/** 背景的来源（主题色、渐变、封面、图片、视频）。 */
export const sourceLabel = (type: BackgroundSource['type']) => t(`media:sources.${type}`);

export const describeBackground = (clip: BackgroundClip) => {
    const assets = useProjectStore.getState().project.assets;
    const source = clip.source;
    const timing = timingLabel(clip.timing.type);
    if (source.type !== 'image' && source.type !== 'video') return `${sourceLabel(source.type)} · ${timing}`;
    const name = assets.find(item => item.id === source.assetId)?.name ?? t('media:assetDeleted');
    return `${t('media:backgroundFile', { name, source: sourceLabel(source.type) })} · ${timing}`;
};

/** 播放头所在段落的挂载（没有段落时全曲）。 */
export const playheadParagraphTiming = (): ClipTiming => {
    const { paragraph } = locateAt(getAgentState().program, clock.get());
    return paragraph ? { type: 'paragraph', anchor: paragraph.anchor } : { type: 'song' };
};

export const addBackgroundAt = (source: BackgroundSource, scope: 'song' | 'paragraph') => {
    const clip = addBackgroundClip(source, scope === 'song' ? { type: 'song' } : playheadParagraphTiming());
    setSession({ selection: { type: 'background', clipId: clip.id } });
    return clip;
};

export const backgroundMenu = (clip: ResolvedBackgroundClip): ContextMenuItem[] => [
    { label: timingLabel('song'), checked: clip.timing.type === 'song', run: () => updateBackgroundClip(clip.id, { timing: { type: 'song' } }) },
    { label: t('media:menu.followParagraph'), run: () => updateBackgroundClip(clip.id, { timing: playheadParagraphTiming() }) },
    { label: t('media:menu.detach'), disabled: clip.timing.type === 'absolute' || clip.timing.type === 'song', run: () => updateBackgroundClip(clip.id, { timing: { type: 'absolute', start: clip.start, end: clip.end } }) },
    'separator',
    { label: t('media:menu.raise'), run: () => moveBackgroundClip(clip.id, 1) },
    { label: t('media:menu.lower'), run: () => moveBackgroundClip(clip.id, -1) },
    'separator',
    { label: t('media:menu.jumpToStart'), run: () => seek(clip.start) },
    { label: t('media:menu.delete'), run: () => { removeBackgroundClip(clip.id); setSession({ selection: { type: 'none' } }); } },
];
