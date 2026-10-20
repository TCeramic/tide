// src/app/autoArrange/autoArrangeActions.ts
// 自动编排的执行（素材库与向导共用）：按当前编排算出片段，替换掉上一次自动编排的片段（用户自己摆的不动），
// 一次写进工程 = 一步撤销。选项在本次会话里记住，两处共用。
import { create } from 'zustand';
import { getAgentState } from '@/agent/host';
import { DEFAULT_ARRANGE_OPTIONS, isAutoClip, planAutoArrangement, type ArrangeOptions } from '@/core/assets/autoArrange';
import { newId } from '@/project/defaults';
import { updateProject, useProjectStore } from '@/project/store';
import { OUTPUT_LOGICAL_SIZES } from '@/project/types';
import { log } from '../output';
import { t } from '@/i18n';

export const useArrangeOptions = create<ArrangeOptions>(() => DEFAULT_ARRANGE_OPTIONS);
export const setArrangeOptions = (patch: Partial<ArrangeOptions>) => useArrangeOptions.setState(patch);

/** 素材库里能自动编排的图（视频只能做背景）。assetIds 给了就只用这些，按给的顺序。 */
const arrangeableImages = (assetIds: string[] | null) => {
    const images = useProjectStore.getState().project.assets.filter(asset => asset.kind === 'image');
    if (!assetIds) return images;
    return assetIds.map(id => images.find(asset => asset.id === id)).filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
};

/** 自动编排；返回放了多少个片段。 */
export const autoArrangeAssets = (assetIds: string[] | null = null, options: ArrangeOptions = useArrangeOptions.getState()) => {
    const images = arrangeableImages(assetIds);
    const { program } = getAgentState();
    const { aspect } = useProjectStore.getState().project;
    const frame = OUTPUT_LOGICAL_SIZES[aspect];
    const clips = planAutoArrangement(
        images.map(image => ({ id: image.id, width: image.width, height: image.height })),
        program,
        frame.width / frame.height,
        options,
        newId,
    );
    updateProject(project => ({ ...project, assetClips: [...project.assetClips.filter(clip => !isAutoClip(clip)), ...clips] }));
    log(clips.length > 0
        ? t('media:autoArrange.placed', { images: t('media:autoArrange.imageCount', { count: images.length }), count: clips.length })
        : images.length === 0 ? t('media:autoArrange.noImages') : t('media:autoArrange.noShots'));
    return clips.length;
};

/** 删掉自动编排的片段（用户自己摆的不动）。 */
export const clearAutoArrangement = () => updateProject(project => ({ ...project, assetClips: project.assetClips.filter(clip => !isAutoClip(clip)) }));

export const useAutoClipCount = () => useProjectStore(state => state.project.assetClips.filter(isAutoClip).length);
