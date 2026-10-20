// src/app/inspector/ClipInspector.tsx
// 检查器：选中的素材片段。时间（跟随镜头 / 段落 / 歌词行，或绝对时间）、层级、位置与大小、混合、跟随运镜、入场 / 退场。
// 预览上也可以直接拖动与缩放（见 Preview 的 ClipHandles）。
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ASSET_SLOTS, CLIP_ANIMATIONS, CLIP_EFFECTS, CLIP_MOTIONS, FOLLOW_MODES, normalizeClipEffect, normalizeClipMotion, resolveAssetClips, type AssetBlend, type AssetClip, type AssetSlot, type ClipAnimationType, type ClipEffect, type ClipEffectType, type ClipMotionType, type FollowMode } from '@/core/assets/clips';
import { removeAssetClip, updateAssetClip } from '@/project/assets';
import { setSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { t as translate } from '@/i18n';
import { anchorClipAtPlayhead, detachClip, slotLabel, timingLabel } from '../clipActions';
import { useProgram } from '../DerivedProvider';
import { AssetThumb } from '../views/LibraryView';
import { seek } from '../playback';
import { formatTime } from '../Transport';
import { Button, Field, inputClass, Section, Segmented, Slider, Toggle } from '../ui';

const BLENDS: AssetBlend[] = ['normal', 'add', 'multiply', 'screen'];

// 选项的名字（自动编排的面板也用）。
export const motionLabel = (type: ClipMotionType) => translate(`media:motions.${type}`);
export const effectLabel = (type: ClipEffectType) => translate(`media:effects.${type}`);
export const followLabel = (mode: FollowMode) => translate(`media:followModes.${mode}`);
const animationLabel = (type: ClipAnimationType) => translate(`media:animations.${type}`);
const blendLabel = (blend: AssetBlend) => translate(`media:blends.${blend}`);

export function ClipInspector({ clipId }: { clipId: string }) {
    const clip = useProjectStore(state => state.project.assetClips.find(item => item.id === clipId));
    const assets = useProjectStore(state => state.project.assets);
    const program = useProgram();
    const { t } = useTranslation(['media', 'common']);
    const resolved = useMemo(() => (clip ? resolveAssetClips([clip], program, new Set(assets.map(item => item.id))) : null), [clip, program, assets]);
    if (!clip) {
        return (
            <div className="space-y-2 px-4 py-3 text-xs text-zinc-500">
                {t('clip.deleted')}
                <Button size="sm" onClick={() => setSession({ selection: { type: 'none' } })}>{t('common:clearSelection')}</Button>
            </div>
        );
    }
    const asset = assets.find(item => item.id === clip.assetId);
    const range = resolved?.resolved[0];
    const patch = (value: Partial<AssetClip>, key?: string) => updateAssetClip(clip.id, value, key);
    const follow = clip.follow ?? 'off';

    return (
        <>
            <Section title={t('clip.title')}>
                <div className="flex gap-2">
                    <AssetThumb assetId={clip.assetId} className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-zinc-950" />
                    <div className="min-w-0 text-xs">
                        <div className="truncate text-zinc-200">{asset?.name ?? t('clip.assetMissing')}</div>
                        <div className="text-zinc-500">{range ? `${formatTime(range.start)} – ${formatTime(range.end)}` : t('clip.hidden')}</div>
                    </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {range && <Button size="sm" onClick={() => seek(range.start + 0.01)}>{t('menu.jumpToStart')}</Button>}
                    <Button size="sm" variant="danger" onClick={() => { removeAssetClip(clip.id); setSession({ selection: { type: 'none' } }); }}>{t('menu.delete')}</Button>
                </div>
            </Section>
            <Section title={t('clip.timing')}>
                <div className="text-xs text-zinc-300">{t('follows', { timing: timingLabel(clip.timing.type) })}</div>
                <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" onClick={() => anchorClipAtPlayhead(clip, 'shot')}>{t('menu.followShot')}</Button>
                    <Button size="sm" onClick={() => anchorClipAtPlayhead(clip, 'paragraph')}>{t('clip.followParagraph')}</Button>
                    {clip.timing.type !== 'absolute' && range && <Button size="sm" variant="ghost" onClick={() => detachClip(range)}>{t('menu.detach')}</Button>}
                </div>
                {clip.timing.type === 'absolute' ? (
                    <div className="grid grid-cols-2 gap-2">
                        <Field label={t('common:startSeconds')}>
                            <input type="number" step={0.01} min={0} value={clip.timing.start} className={`${inputClass} select-text`}
                                onChange={event => { const start = Number(event.target.value); if (Number.isFinite(start) && clip.timing.type === 'absolute') patch({ timing: { ...clip.timing, start } }, 'start'); }} />
                        </Field>
                        <Field label={t('common:endSeconds')}>
                            <input type="number" step={0.01} min={0} value={clip.timing.end} className={`${inputClass} select-text`}
                                onChange={event => { const end = Number(event.target.value); if (Number.isFinite(end) && clip.timing.type === 'absolute') patch({ timing: { ...clip.timing, end } }, 'end'); }} />
                        </Field>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        <Field label={t('clip.lead')}>
                            <Slider value={clip.lead} min={-2} max={4} step={0.05} onChange={lead => patch({ lead }, 'lead')} format={v => v.toFixed(2)} />
                        </Field>
                        <Field label={t('clip.tail')}>
                            <Slider value={clip.tail} min={-2} max={4} step={0.05} onChange={tail => patch({ tail }, 'tail')} format={v => v.toFixed(2)} />
                        </Field>
                    </div>
                )}
            </Section>
            <Section title={t('clip.look')}>
                <Field label={t('clip.slot')} hint={clip.slot === 'back' ? t('clip.slotBackHint') : clip.slot === 'mid' ? t('clip.slotMidHint') : undefined}>
                    <Segmented<AssetSlot>
                        value={clip.slot}
                        onChange={slot => patch({ slot })}
                        options={ASSET_SLOTS.map(slot => ({ value: slot, label: slotLabel(slot) }))}
                    />
                </Field>
                <Field label={t('clip.position')}>
                    <Slider value={clip.x} min={-0.2} max={1.2} step={0.005} onChange={x => patch({ x }, 'x')} format={v => `X ${Math.round(v * 100)}%`} />
                    <Slider value={clip.y} min={-0.2} max={1.2} step={0.005} onChange={y => patch({ y }, 'y')} format={v => `Y ${Math.round(v * 100)}%`} />
                </Field>
                <Field label={t('clip.size')}>
                    <Slider value={clip.scale} min={0.05} max={2} step={0.01} onChange={scale => patch({ scale }, 'scale')} format={v => `${Math.round(v * 100)}%`} />
                </Field>
                <Field label={t('clip.rotation')}>
                    <Slider value={clip.rotation} min={-Math.PI} max={Math.PI} step={0.01} onChange={rotation => patch({ rotation }, 'rotation')} format={v => `${Math.round((v * 180) / Math.PI)}°`} />
                </Field>
                <Field label={t('clip.opacity')}>
                    <Slider value={clip.opacity} min={0} max={1} step={0.01} onChange={opacity => patch({ opacity }, 'opacity')} format={v => `${Math.round(v * 100)}%`} />
                </Field>
                <Toggle label={t('clip.flip')} checked={clip.flipX} onChange={flipX => patch({ flipX })} />
                <Field label={t('clip.blend')}>
                    <select value={clip.blend} onChange={event => patch({ blend: event.target.value as AssetBlend })} className={inputClass}>
                        {BLENDS.map(blend => <option key={blend} value={blend}>{blendLabel(blend)}</option>)}
                    </select>
                </Field>
            </Section>
            <EffectSection clip={clip} patch={patch} />
            <Section title={t('clip.follow')}>
                <Field label={t('clip.followMode')} hint={t(`followHints.${follow}`)}>
                    <Segmented<FollowMode>
                        value={follow}
                        onChange={value => patch({ follow: value })}
                        options={FOLLOW_MODES.map(mode => ({ value: mode, label: followLabel(mode) }))}
                    />
                </Field>
                {follow !== 'off' && (
                    <Field label={t('clip.followAmount')} hint={t('clip.followAmountHint')}>
                        <Slider value={clip.followAmount ?? 1} min={0} max={1} step={0.05} onChange={followAmount => patch({ followAmount }, 'follow-amount')} format={v => `${Math.round(v * 100)}%`} />
                    </Field>
                )}
            </Section>
            <Section title={t('clip.animation')}>
                <MotionFields clip={clip} patch={patch} />
                {(['enter', 'exit'] as const).map(key => (
                    <Field key={key} label={t(`clip.${key}`)}>
                        <div className="grid grid-cols-[1fr_5rem] gap-2">
                            <select value={clip[key].type} onChange={event => patch({ [key]: { ...clip[key], type: event.target.value as ClipAnimationType } })} className={inputClass}>
                                {CLIP_ANIMATIONS.map(type => <option key={type} value={type}>{animationLabel(type)}</option>)}
                            </select>
                            <input type="number" step={0.05} min={0} max={5} value={clip[key].duration} aria-label={t(`clip.${key}Duration`)} className={`${inputClass} select-text`}
                                onChange={event => { const duration = Number(event.target.value); if (Number.isFinite(duration)) patch({ [key]: { ...clip[key], duration: Math.max(0, duration) } }, `${key}-duration`); }} />
                        </div>
                    </Field>
                ))}
            </Section>
        </>
    );
}

function EffectSection({ clip, patch }: { clip: AssetClip; patch: (value: Partial<AssetClip>, key?: string) => void }) {
    const effect = normalizeClipEffect(clip.effect);
    const set = (value: Partial<ClipEffect>, key?: string) => patch({ effect: { ...effect, ...value } }, key ? `effect-${key}` : undefined);
    const { t } = useTranslation('media');
    return (
        <Section title={t('effect.title')}>
            <Field label={t('effect.type')} hint={effect.type === 'none' ? undefined : t(`effectHints.${effect.type}`)}>
                <Segmented<ClipEffectType>
                    value={effect.type}
                    onChange={type => set({ type })}
                    options={CLIP_EFFECTS.map(type => ({ value: type, label: effectLabel(type) }))}
                />
            </Field>
            {effect.type !== 'none' && (
                <>
                    <Field label={t('effect.color')}>
                        <input type="color" aria-label={t('effect.colorLabel')} value={effect.color} onChange={event => set({ color: event.target.value }, 'color')} className="h-8 w-full rounded border border-zinc-700 bg-transparent" />
                    </Field>
                    <Field label={t(`effectSizes.${effect.type}`)}>
                        <Slider value={effect.size} min={0} max={1} step={0.01} onChange={size => set({ size }, 'size')} format={v => `${Math.round(v * 100)}%`} />
                    </Field>
                    <Field label={t('effect.strength')}>
                        <Slider value={effect.opacity} min={0} max={1} step={0.01} onChange={opacity => set({ opacity }, 'opacity')} format={v => `${Math.round(v * 100)}%`} />
                    </Field>
                    {effect.type === 'echo' && (
                        <Field label={t('effect.period')}>
                            <Slider value={effect.period} min={0.3} max={4} step={0.05} onChange={period => set({ period }, 'period')} format={v => `${v.toFixed(2)}s`} />
                        </Field>
                    )}
                </>
            )}
        </Section>
    );
}

function MotionFields({ clip, patch }: { clip: AssetClip; patch: (value: Partial<AssetClip>, key?: string) => void }) {
    const motion = normalizeClipMotion(clip.motion);
    const { t } = useTranslation('media');
    return (
        <>
            <Field label={t('motion.title')} hint={t(`motionHints.${motion.type}`)}>
                <Segmented<ClipMotionType>
                    value={motion.type}
                    onChange={type => patch({ motion: { ...motion, type } })}
                    options={CLIP_MOTIONS.map(type => ({ value: type, label: motionLabel(type) }))}
                />
            </Field>
            {motion.type !== 'none' && (
                <Field label={t('motion.amount')}>
                    <Slider value={motion.amount} min={0} max={1} step={0.01} onChange={amount => patch({ motion: { ...motion, amount } }, 'motion-amount')} format={v => `${Math.round(v * 100)}%`} />
                </Field>
            )}
        </>
    );
}
