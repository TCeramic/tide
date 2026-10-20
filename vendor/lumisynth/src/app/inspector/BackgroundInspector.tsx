// src/app/inspector/BackgroundInspector.tsx
// 检查器：选中的背景片段。来源（主题色 / 渐变 / 封面 / 素材库图片或视频）、时间、铺满方式、推近、模糊、压暗、淡入淡出。
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveBackgroundClips, type BackgroundClip, type BackgroundSource } from '@/core/assets/background';
import { moveBackgroundClip, removeBackgroundClip, updateBackgroundClip } from '@/project/assets';
import { setSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { BACKGROUND_SOURCES, playheadParagraphTiming, sourceLabel } from '../backgroundActions';
import { timingLabel } from '../clipActions';
import { useProgram } from '../DerivedProvider';
import { seek } from '../playback';
import { formatTime } from '../Transport';
import { Button, Field, inputClass, Section, Segmented, Slider, Toggle } from '../ui';

export function BackgroundInspector({ clipId }: { clipId: string }) {
    const clip = useProjectStore(state => state.project.backgroundClips.find(item => item.id === clipId));
    const assets = useProjectStore(state => state.project.assets);
    const program = useProgram();
    const { t } = useTranslation(['media', 'common']);
    const resolved = useMemo(() => (clip ? resolveBackgroundClips([clip], program, new Set(assets.map(item => item.id))).resolved[0] ?? null : null), [clip, program, assets]);
    if (!clip) {
        return (
            <div className="space-y-2 px-4 py-3 text-xs text-zinc-500">
                {t('background.deleted')}
                <Button size="sm" onClick={() => setSession({ selection: { type: 'none' } })}>{t('common:clearSelection')}</Button>
            </div>
        );
    }
    const patch = (value: Partial<BackgroundClip>, key?: string) => updateBackgroundClip(clip.id, value, key);
    const source = clip.source;
    const images = assets.filter(item => item.kind === 'image');
    const videos = assets.filter(item => item.kind === 'video');

    const setSourceType = (type: BackgroundSource['type']) => {
        if (type === source.type) return;
        if (type === 'theme' || type === 'cover') patch({ source: { type } });
        else if (type === 'gradient') patch({ source: { type, from: '#1e1b4b', to: '#0f766e', angle: 20 } });
        else if (type === 'image' && images[0]) patch({ source: { type, assetId: images[0].id } });
        else if (type === 'video' && videos[0]) patch({ source: { type, assetId: videos[0].id, offset: 0, loop: true } });
    };

    return (
        <>
            <Section title={t('background.title')}>
                <div className="text-xs text-zinc-400">
                    {resolved ? `${formatTime(resolved.start)} – ${resolved.timing.type === 'song' ? timingLabel('song') : formatTime(resolved.end)}` : t('background.hidden')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {resolved && <Button size="sm" onClick={() => seek(resolved.start + 0.01)}>{t('menu.jumpToStart')}</Button>}
                    <Button size="sm" onClick={() => moveBackgroundClip(clip.id, 1)}>{t('background.raise')}</Button>
                    <Button size="sm" onClick={() => moveBackgroundClip(clip.id, -1)}>{t('menu.lower')}</Button>
                    <Button size="sm" variant="danger" onClick={() => { removeBackgroundClip(clip.id); setSession({ selection: { type: 'none' } }); }}>{t('menu.delete')}</Button>
                </div>
                <div className="text-[11px] text-zinc-500">{t('background.stacking')}</div>
            </Section>
            <Section title={t('background.source')}>
                <select aria-label={t('background.sourceLabel')} value={source.type} onChange={event => setSourceType(event.target.value as BackgroundSource['type'])} className={inputClass}>
                    {BACKGROUND_SOURCES.map(type => (
                        <option key={type} value={type} disabled={(type === 'image' && images.length === 0) || (type === 'video' && videos.length === 0)}>
                            {sourceLabel(type)}{type === 'image' && images.length === 0 ? t('background.noImages') : ''}{type === 'video' && videos.length === 0 ? t('background.noVideos') : ''}
                        </option>
                    ))}
                </select>
                {source.type === 'gradient' && (
                    <>
                        <div className="grid grid-cols-2 gap-2">
                            <input type="color" aria-label={t('background.gradientFrom')} value={source.from} onChange={event => patch({ source: { ...source, from: event.target.value } }, 'from')} className="h-8 w-full cursor-pointer rounded border border-zinc-700 bg-transparent" />
                            <input type="color" aria-label={t('background.gradientTo')} value={source.to} onChange={event => patch({ source: { ...source, to: event.target.value } }, 'to')} className="h-8 w-full cursor-pointer rounded border border-zinc-700 bg-transparent" />
                        </div>
                        <Slider value={source.angle} min={0} max={360} step={1} onChange={angle => patch({ source: { ...source, angle } }, 'angle')} format={v => `${v}°`} />
                    </>
                )}
                {(source.type === 'image' || source.type === 'video') && (
                    <select aria-label={t('background.asset')} value={source.assetId} onChange={event => patch({ source: { ...source, assetId: event.target.value } })} className={inputClass}>
                        {(source.type === 'image' ? images : videos).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                )}
                {source.type === 'video' && (
                    <>
                        <Field label={t('background.videoOffset')}>
                            <input type="number" min={0} step={0.1} value={source.offset} className={`${inputClass} select-text`}
                                onChange={event => { const offset = Number(event.target.value); if (Number.isFinite(offset)) patch({ source: { ...source, offset: Math.max(0, offset) } }, 'offset'); }} />
                        </Field>
                        <Toggle label={t('background.loop')} checked={source.loop} onChange={loop => patch({ source: { ...source, loop } })} />
                        <div className="text-[11px] text-zinc-500">{t('background.videoNote')}</div>
                    </>
                )}
            </Section>
            <Section title={t('clip.timing')}>
                <div className="text-xs text-zinc-300">{t('follows', { timing: timingLabel(clip.timing.type) })}</div>
                <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" onClick={() => patch({ timing: { type: 'song' } })}>{timingLabel('song')}</Button>
                    <Button size="sm" onClick={() => patch({ timing: playheadParagraphTiming() })}>{t('menu.followParagraph')}</Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Field label={t('background.fadeIn')}><Slider value={clip.fadeIn} min={0} max={4} step={0.05} onChange={fadeIn => patch({ fadeIn }, 'fadeIn')} format={v => v.toFixed(2)} /></Field>
                    <Field label={t('background.fadeOut')}><Slider value={clip.fadeOut} min={0} max={4} step={0.05} onChange={fadeOut => patch({ fadeOut }, 'fadeOut')} format={v => v.toFixed(2)} /></Field>
                </div>
            </Section>
            {source.type !== 'theme' && (
                <Section title={t('clip.look')}>
                    {source.type !== 'gradient' && (
                        <Field label={t('background.fit')}>
                            <Segmented<BackgroundClip['fit']> value={clip.fit} onChange={fit => patch({ fit })} options={[{ value: 'cover', label: t('background.fitCover') }, { value: 'contain', label: t('background.fitContain') }]} />
                        </Field>
                    )}
                    <Field label={t('background.kenBurns')}><Slider value={clip.kenBurns} min={0} max={0.3} step={0.01} onChange={kenBurns => patch({ kenBurns }, 'kenBurns')} format={v => `${Math.round(v * 100)}%`} /></Field>
                    <Field label={t('background.blur')}><Slider value={clip.blur} min={0} max={40} step={1} onChange={blur => patch({ blur }, 'blur')} format={v => `${v}px`} /></Field>
                    <Field label={t('background.dim')}><Slider value={clip.dim} min={0} max={1} step={0.01} onChange={dim => patch({ dim }, 'dim')} format={v => `${Math.round(v * 100)}%`} /></Field>
                </Section>
            )}
        </>
    );
}
