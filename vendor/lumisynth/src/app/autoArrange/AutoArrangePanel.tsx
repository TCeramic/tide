// src/app/autoArrange/AutoArrangePanel.tsx
// 自动编排的选项与按钮（素材库与向导共用）：层级、跟随运镜、效果、构图变化、放在哪些段落。
import { LayoutTemplate, Trash2 } from 'lucide-react';
import { ASSET_SLOTS, CLIP_EFFECTS, CLIP_MOTIONS, FOLLOW_MODES, type AssetSlot, type ClipEffectType, type ClipMotionType, type FollowMode } from '@/core/assets/clips';
import type { ArrangeCoverage } from '@/core/assets/autoArrange';
import { slotLabel } from '../clipActions';
import { useTranslation } from 'react-i18next';
import { effectLabel, followLabel, motionLabel } from '../inspector/ClipInspector';
import { Button, Field, inputClass, Segmented, Slider } from '../ui';
import { autoArrangeAssets, clearAutoArrangement, setArrangeOptions, useArrangeOptions, useAutoClipCount } from './autoArrangeActions';

export function ArrangeOptionsFields() {
    const options = useArrangeOptions();
    const { t } = useTranslation('media');
    return (
        <>
            <Field label={t('autoArrange.coverage')}>
                <Segmented<ArrangeCoverage>
                    value={options.coverage}
                    onChange={coverage => setArrangeOptions({ coverage })}
                    options={[{ value: 'all', label: t('autoArrange.coverageAll') }, { value: 'highlights', label: t('autoArrange.coverageHighlights') }]}
                />
            </Field>
            <Field label={t('autoArrange.probability')} hint={t('autoArrange.probabilityHint')}>
                <Slider value={options.probability} min={0} max={1} step={0.05} onChange={probability => setArrangeOptions({ probability })} format={v => `${Math.round(v * 100)}%`} />
            </Field>
            <Field label={t('autoArrange.variety')} hint={t('autoArrange.varietyHint')}>
                <Slider value={options.variety} min={0} max={1} step={0.05} onChange={variety => setArrangeOptions({ variety })} format={v => `${Math.round(v * 100)}%`} />
            </Field>
            <Field label={t('clip.slot')}>
                <select aria-label={t('autoArrange.slotLabel')} value={options.slot} onChange={event => setArrangeOptions({ slot: event.target.value as AssetSlot })} className={inputClass}>
                    {ASSET_SLOTS.map(slot => <option key={slot} value={slot}>{slotLabel(slot)}</option>)}
                </select>
            </Field>
            <Field label={t('clip.follow')}>
                <Segmented<FollowMode>
                    value={options.follow}
                    onChange={follow => setArrangeOptions({ follow })}
                    options={FOLLOW_MODES.map(mode => ({ value: mode, label: followLabel(mode) }))}
                />
            </Field>
            <Field label={t('motion.title')} hint={t('autoArrange.motionHint')}>
                <Segmented<ClipMotionType>
                    value={options.motion}
                    onChange={motion => setArrangeOptions({ motion })}
                    options={CLIP_MOTIONS.map(type => ({ value: type, label: motionLabel(type) }))}
                />
            </Field>
            <Field label={t('effect.title')}>
                <div className="flex gap-2">
                    <select aria-label={t('autoArrange.effectLabel')} value={options.effect} onChange={event => setArrangeOptions({ effect: event.target.value as ClipEffectType })} className={inputClass}>
                        {CLIP_EFFECTS.map(type => <option key={type} value={type}>{effectLabel(type)}</option>)}
                    </select>
                    {options.effect !== 'none' && (
                        <input type="color" aria-label={t('effect.colorLabel')} value={options.effectColor} onChange={event => setArrangeOptions({ effectColor: event.target.value })} className="h-8 w-10 shrink-0 rounded border border-zinc-700 bg-transparent" />
                    )}
                </div>
            </Field>
        </>
    );
}

/** assetIds：只用这些图（例如素材库里选中的）；null = 素材库里的全部图片。 */
export function AutoArrangePanel({ assetIds, imageCount }: { assetIds: string[] | null; imageCount: number }) {
    const autoCount = useAutoClipCount();
    const { t } = useTranslation('media');
    return (
        <div className="space-y-2.5">
            <ArrangeOptionsFields />
            <div className="flex gap-1.5">
                <Button variant="primary" className="flex-1" disabled={imageCount === 0} onClick={() => autoArrangeAssets(assetIds)}>
                    <LayoutTemplate size={14} /> {t(autoCount > 0 ? 'autoArrange.rearrange' : 'autoArrange.arrange', { images: t(assetIds ? 'autoArrange.selectedImages' : 'autoArrange.allImages', { count: imageCount }) })}
                </Button>
                {autoCount > 0 && (
                    <Button variant="ghost" onClick={clearAutoArrangement} title={t('autoArrange.clear', { count: autoCount })}>
                        <Trash2 size={14} />
                    </Button>
                )}
            </div>
            <div className="text-[11px] leading-relaxed text-zinc-500">
                {t('autoArrange.explain')}{autoCount > 0 ? t('autoArrange.existing', { count: autoCount }) : t('autoArrange.afterwards')}
            </div>
        </div>
    );
}
