// src/app/clipActions.ts
// 素材片段的常用操作：时间轴右键菜单、检查器、快捷键共用。
import type { AssetClip, AssetSlot, ClipTiming, ResolvedAssetClip } from '@/core/assets/clips';
import { ASSET_SLOTS } from '@/core/assets/clips';
import { getAgentState } from '@/agent/host';
import { duplicateAssetClip, removeAssetClip, updateAssetClip } from '@/project/assets';
import { setSession } from '@/project/session';
import { locateAt } from './arrangeActions';
import { clock, seek } from './playback';
import type { ContextMenuItem } from './workbench/ContextMenu';
import { t } from '@/i18n';

/** 素材片段的层级。 */
export const slotLabel = (slot: AssetSlot) => t(`media:slots.${slot}`);

/** 挂载方式（全曲、绝对时间、跟随歌词行 / 段落 / 镜头）。 */
export const timingLabel = (type: ClipTiming['type']) => t(`media:timings.${type}`);

/** 把片段挂到播放头所在的镜头 / 段落上（不改外观）。 */
export const anchorClipAtPlayhead = (clip: AssetClip, to: 'shot' | 'paragraph') => {
    const { program } = getAgentState();
    const { paragraph, shot } = locateAt(program, clock.get());
    const timing: ClipTiming | null = to === 'shot'
        ? (shot ? { type: 'shot', anchor: shot.anchor } : null)
        : (paragraph ? { type: 'paragraph', anchor: paragraph.anchor } : null);
    if (timing) updateAssetClip(clip.id, { timing, lead: 0, tail: 0 });
};

/** 改为绝对时间（保持当前的起止时刻）。 */
export const detachClip = (clip: ResolvedAssetClip) => updateAssetClip(clip.id, { timing: { type: 'absolute', start: clip.start, end: clip.end }, lead: 0, tail: 0 });

export const clipMenu = (clip: ResolvedAssetClip): ContextMenuItem[] => [
    ...ASSET_SLOTS.map(slot => ({
        label: t('media:menu.slot', { slot: slotLabel(slot) }),
        checked: clip.slot === slot,
        run: () => updateAssetClip(clip.id, { slot }),
    })),
    'separator',
    { label: t('media:menu.followShot'), run: () => anchorClipAtPlayhead(clip, 'shot') },
    { label: t('media:menu.followParagraph'), run: () => anchorClipAtPlayhead(clip, 'paragraph') },
    { label: t('media:menu.detach'), run: () => detachClip(clip), disabled: clip.timing.type === 'absolute' },
    'separator',
    { label: t('media:menu.jumpToStart'), run: () => seek(clip.start) },
    {
        label: t('media:menu.duplicate'), run: () => {
            const copy = duplicateAssetClip(clip.id);
            if (copy) setSession({ selection: { type: 'clip', clipId: copy.id } });
        },
    },
    { label: t('media:menu.delete'), keybinding: 'Delete', run: () => { removeAssetClip(clip.id); setSession({ selection: { type: 'none' } }); } },
];
