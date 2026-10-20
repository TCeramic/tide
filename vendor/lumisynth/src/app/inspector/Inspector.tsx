// src/app/inspector/Inspector.tsx
// 辅助栏「检查器」：按选中对象（段落 / shot / 歌词行）编辑；未选中时显示编排总设置。
import { BackgroundInspector } from './BackgroundInspector';
import { ClipInspector } from './ClipInspector';
import { mergeWithPrevious, resetParagraphStructure } from '@/project/structure';
import { pickParagraphKind } from '../arrangeActions';
import { log } from '../output';
import { StylePickerGrid } from './StylePickerGrid';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart, Lock, Ban, Unlock } from 'lucide-react';
import { borrowableTypographies, familyLabel, findPack, getStyle, getTransition, listPacks } from '@/packs/registry';
import { DEFAULT_MIX_BY_KIND, mixAssignment, mixOverrides, PARAGRAPH_KINDS, type LumiParagraph, type LumiShot, type PackId, type StyleId, type TransitionId } from '@/compiler/types';
import { anchorOfLine } from '@/core/lyrics/edits';
import { isValidWordSegmentation, segmentLyricWords } from '@/core/lyrics/wordSegmentation';
import {
    setShotComponent,
    lockCurrentStyle,
    lockShotStyle,
    setParagraphDirection,
    setParagraphTransition,
    toggleBlocked,
    toggleFavorite,
    unlockShotStyle,
} from '@/project/edits';
import { repairLineSegmentation, resetLineText, resetLineTiming, resetLineTranslation, segmentationRepairFor, setLineBounds, setLineSegments, setLineTranslation } from '@/project/lyrics';
import { setSession, useSession } from '@/project/session';
import { updateProject, useProjectStore } from '@/project/store';
import { packLabel, packShortLabel, paragraphKindLabel } from '@/i18n/catalog';
import { useEffectiveLyrics, useProgram } from '../DerivedProvider';
import { seek } from '../playback';
import { formatTime } from '../Transport';
import { Button, cx, Field, inputClass, Section, Segmented, Slider, Toggle } from '../ui';

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-zinc-500">{label}</span>
            <span className="truncate text-right text-zinc-200">{children}</span>
        </div>
    );
}

function StyleActions({ style }: { style: StyleId }) {
    const favorite = useProjectStore(state => state.project.library.favorites.includes(style));
    const blocked = useProjectStore(state => state.project.library.blocked.includes(style));
    const { t } = useTranslation('inspector');
    return (
        <div className="flex gap-1.5">
            <Button size="sm" variant={favorite ? 'primary' : 'default'} onClick={() => toggleFavorite(style)}>
                <Heart size={12} /> {favorite ? t('style.favorited') : t('style.favorite')}
            </Button>
            <Button size="sm" variant={blocked ? 'danger' : 'default'} onClick={() => toggleBlocked(style)}>
                <Ban size={12} /> {blocked ? t('style.blocked') : t('style.block')}
            </Button>
        </div>
    );
}

function ParagraphInspector({ paragraph }: { paragraph: LumiParagraph }) {
    const program = useProgram();
    const { t } = useTranslation(['inspector', 'arrange', 'common']);
    const override = useProjectStore(state => state.project.paragraphDirections.find(item => (
        item.anchor.line.index === paragraph.anchor.line.index && item.anchor.line.hash === paragraph.anchor.line.hash
    )));
    const transitionOp = useProjectStore(state => state.project.overrides.find(op => (
        op.type === 'transition' && op.anchor.line.index === paragraph.anchor.line.index && op.anchor.line.hash === paragraph.anchor.line.hash
    )));
    const { direction } = paragraph;
    const families = findPack(direction.pack)?.families ?? [];
    const activeFamilies = direction.families?.filter(id => families.some(family => family.id === id)) ?? null;
    const kind = paragraphKindLabel(paragraph.kind);
    const boundary = t(`paragraph.boundaries.${paragraph.boundary}`);

    return (
        <>
            <Section title={t('paragraph.title')}>
                <Row label={t('paragraph.kind')}>{paragraph.kindManual ? t('paragraph.manualValue', { value: kind }) : kind}</Row>
                <Row label={t('paragraph.time')}>{formatTime(paragraph.startTime)} – {formatTime(paragraph.endTime)}</Row>
                <Row label={t('paragraph.boundary')}>{paragraph.merged ? t('paragraph.boundaryMerged', { boundary }) : boundary}</Row>
                <Row label={t('paragraph.shots')}>{paragraph.shots.length}</Row>
                <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" onClick={() => seek(paragraph.startTime)}>{t('paragraph.jumpToStart')}</Button>
                    <Button size="sm" onClick={() => void pickParagraphKind(paragraph)}>{t('paragraph.changeKind')}</Button>
                    <Button size="sm" disabled={paragraph.index === 0} onClick={() => mergeWithPrevious(program, paragraph, message => log(message))}>{t('arrange:menu.mergePrevious')}</Button>
                    {(paragraph.boundary === 'manual' || paragraph.merged) && (
                        <Button size="sm" variant="ghost" onClick={() => resetParagraphStructure(program, paragraph, message => log(message))}>{t('arrange:menu.resetStructure')}</Button>
                    )}
                </div>
                <div className="text-[11px] text-zinc-500">{t('paragraph.splitHint')}</div>
            </Section>
            <Section title={t('paragraph.direction')}>
                <Field label={t('paragraph.pack')}>
                    <Segmented<'auto' | PackId>
                        value={override?.pack ?? 'auto'}
                        onChange={value => setParagraphDirection(paragraph, { pack: value })}
                        options={[
                            { value: 'auto', label: t('common:auto') },
                            ...listPacks().map(pack => ({ value: pack.id, label: packShortLabel(pack.id) })),
                        ]}
                    />
                </Field>
                <Field label={t('arrange:storyboard.energy')} hint={t('paragraph.energyHint')}>
                    <Toggle
                        label={t('paragraph.manual')}
                        checked={direction.energy !== null}
                        onChange={checked => setParagraphDirection(paragraph, { energy: checked ? 0.5 : 'auto' })}
                    />
                    {direction.energy !== null && (
                        <Slider
                            value={direction.energy}
                            min={0} max={1} step={0.01}
                            onChange={value => setParagraphDirection(paragraph, { energy: value })}
                            format={value => value.toFixed(2)}
                        />
                    )}
                </Field>
                <Field label={t('paragraph.families')} hint={t('paragraph.familiesHint')}>
                    <div className="flex flex-wrap gap-1">
                        {families.map(family => {
                            const on = activeFamilies?.includes(family.id) ?? false;
                            return (
                                <button
                                    key={family.id}
                                    type="button"
                                    onClick={() => {
                                        const current = activeFamilies ?? [];
                                        const next = on ? current.filter(id => id !== family.id) : [...current, family.id];
                                        setParagraphDirection(paragraph, { families: next.length > 0 ? next : 'auto' });
                                    }}
                                    className={cx('rounded border px-1.5 py-0.5 text-[11px]', on ? 'border-amber-400 bg-amber-400/20 text-amber-100' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200')}
                                >
                                    {family.label}
                                </button>
                            );
                        })}
                    </div>
                </Field>
                {override && <Button size="sm" variant="ghost" onClick={() => setParagraphDirection(paragraph, { pack: 'auto', energy: 'auto', families: 'auto' })}>{t('paragraph.resetAll')}</Button>}
            </Section>
            <Section title={t('arrange:storyboard.transition')}>
                <select
                    value={transitionOp?.type === 'transition' ? transitionOp.transition : 'auto'}
                    onChange={event => setParagraphTransition(paragraph, event.target.value as TransitionId | 'none' | 'auto')}
                    className={inputClass}
                >
                    <option value="auto">{paragraph.transitionOut && transitionOp === undefined ? t('common:autoValue', { value: getTransition(paragraph.transitionOut.id)?.label }) : t('common:auto')}</option>
                    <option value="none">{t('arrange:pick.noTransition')}</option>
                    {listPacks().map(pack => (
                        <optgroup key={pack.id} label={packLabel(pack.id)}>
                            {pack.transitions.map(item => (
                                <option key={item.id} value={item.id}>{item.label}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
                {!paragraph.transitionOut && transitionOp === undefined && <div className="text-xs text-zinc-500">{t('paragraph.lastNoTransition')}</div>}
            </Section>
        </>
    );
}

function ShotInspector({ shot, paragraph }: { shot: LumiShot; paragraph: LumiParagraph }) {
    const program = useProgram();
    const { t } = useTranslation(['inspector', 'arrange', 'common']);
    const shotMixing = useProjectStore(state => state.project.direction.shotMixing);
    const style = getStyle(shot.style);
    const [pickPack, setPickPack] = useState<PackId>(shot.pack);
    const [family, setFamily] = useState<string>(style?.family ?? '');
    const pack = shotMixing ? pickPack : paragraph.direction.pack;
    const styles = (findPack(pack)?.styles ?? []).filter(item => !family || item.family === family);
    const text = shot.lineIndices.map(index => program.lines[index]?.line.fullText).filter(Boolean).join(' / ');
    return (
        <>
            <Section title={t('shot.title')}>
                <Row label={t('shot.style')}>{style ? `${familyLabel(style.pack, style.family)} · ${style.kind}` : shot.style}</Row>
                <Row label="mood">{style?.mood}</Row>
                <Row label={t('paragraph.time')}>{formatTime(shot.startTime)} – {formatTime(shot.endTime)}</Row>
                <Row label={t('shot.paragraph')}>{t('shot.paragraphValue', { kind: paragraphKindLabel(paragraph.kind), pack: packShortLabel(paragraph.direction.pack) })}</Row>
                {shot.isBridge ? <div className="text-xs text-zinc-500">{t('shot.bridge')}</div> : <div className="text-xs text-zinc-400">{text}</div>}
                <div className="flex flex-wrap gap-1.5">
                    {shot.locked ? (
                        <Button size="sm" onClick={() => unlockShotStyle(shot)}><Unlock size={12} /> {t('shot.unlock')}</Button>
                    ) : (
                        <Button size="sm" onClick={() => lockCurrentStyle(shot)}><Lock size={12} /> {t('arrange:menu.lockStyle')}</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => seek(shot.startTime)}>{t('arrange:menu.jumpHere')}</Button>
                </div>
                {style && <StyleActions style={style.id} />}
            </Section>
            {(findPack(shot.pack)?.componentSlots?.length ?? 0) > 0 && (
                <Section title={t('shot.components')}>
                    <div className="text-[11px] text-zinc-500">{t('shot.componentsHint')}</div>
                    {findPack(shot.pack)!.componentSlots!.map(slotDef => {
                        const locked = shot.lockedComponents.includes(slotDef.id);
                        const borrowable = slotDef.id === 'typography' && !shot.isBridge && style
                            ? borrowableTypographies(shot.pack, style.kind)
                            : [];
                        const current = shot.components[slotDef.id];
                        const currentLabel = slotDef.options.find(option => option.id === current)?.label
                            ?? borrowable.find(option => option.value === current)?.label
                            ?? current;
                        return (
                            <Field key={slotDef.id} label={slotDef.label}>
                                <select
                                    value={locked ? current : 'auto'}
                                    onChange={event => setShotComponent(shot, slotDef.id, event.target.value)}
                                    className={inputClass}
                                >
                                    <option value="auto">{t('common:autoValue', { value: currentLabel })}</option>
                                    <optgroup label={packShortLabel(shot.pack)}>
                                        {slotDef.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                                    </optgroup>
                                    {borrowable.length > 0 && (
                                        <optgroup label={t('shot.borrowTypography')}>
                                            {borrowable.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </optgroup>
                                    )}
                                </select>
                            </Field>
                        );
                    })}
                    {shot.borrowedText && (
                        <div className="text-[11px] text-zinc-500">
                            {t('shot.borrowedHint', { text: packShortLabel(shot.borrowedText.pack), host: packShortLabel(shot.pack) })}
                        </div>
                    )}
                </Section>
            )}
            <Section title={t('shot.replace')}>
                {shotMixing && (
                    <Segmented<PackId>
                        value={pickPack}
                        onChange={value => {
                            setPickPack(value);
                            setFamily('');
                        }}
                        options={listPacks().map(item => ({ value: item.id, label: packShortLabel(item.id) }))}
                    />
                )}
                <select value={family} onChange={event => setFamily(event.target.value)} className={inputClass}>
                    <option value="">{t('shot.allFamilies')}</option>
                    {(findPack(pack)?.families ?? []).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                <StylePickerGrid shot={shot} styles={styles} />
                <div className="text-[11px] text-zinc-500">
                    {t('shot.pickerHint')}{shotMixing ? t('shot.pickerMixing') : t('shot.pickerNoMixing')}
                </div>
            </Section>
        </>
    );
}

function LineInspector({ index }: { index: number }) {
    const program = useProgram();
    const { t } = useTranslation(['inspector', 'arrange', 'common', 'problems']);
    const edit = useProjectStore(state => state.project.lyricEdits.lines.find(item => item.anchor.index === index));
    const hasTiming = Boolean(edit && (edit.startTime !== undefined || edit.endTime !== undefined || edit.words));
    const line = program.lines[index]?.line;
    // 选原始数据（引用稳定），修复结果在外面算：选择器每次返回新数组会让 zustand 反复重渲染。
    const segments = useProjectStore(state => state.project.lyricEdits.segments);
    const repair = useMemo(() => {
        if (!line) return null;
        const project = useProjectStore.getState().project;
        return segmentationRepairFor({ ...project, lyricEdits: { ...project.lyricEdits, segments } }, anchorOfLine(line, index), line);
    }, [segments, line, index]);
    const savedParts = useProjectStore(state => state.project.lyricEdits.segments.find(item => item.anchor.index === index)?.parts);
    const [draft, setDraft] = useState<string | null>(null);
    const [translationDraft, setTranslationDraft] = useState<string | null>(null);
    // Esc 放弃编辑：失焦时不写回。
    const discardTranslation = useRef(false);
    const originalTranslation = useEffectiveLyrics().source?.lines[index]?.translation;
    const current = useMemo(() => (line ? segmentLyricWords(line).map((part, i, parts) => (
        line.fullText.slice(part.index, parts[i + 1]?.index ?? line.fullText.length)
    )) : []), [line]);
    if (!line) return <Section title={t('line.title')}><div className="text-xs text-zinc-500">{t('line.missing')}</div></Section>;
    const anchor = anchorOfLine(line, index);
    const draftText = draft ?? current.join('|');
    const parts = draftText.split('|');
    const valid = isValidWordSegmentation(line.fullText, parts);
    return (
        <>
            <Section title={t('line.numbered', { n: index + 1 })}>
                <div data-selectable className="text-sm text-zinc-100">{line.fullText}</div>
                <Field label={t('line.translation')} hint={t('line.translationHint')}>
                    <input
                        value={translationDraft ?? line.translation ?? ''}
                        placeholder={t('line.noTranslation')}
                        onChange={event => setTranslationDraft(event.target.value)}
                        onBlur={() => {
                            if (translationDraft !== null && !discardTranslation.current) setLineTranslation(anchor, translationDraft, originalTranslation);
                            discardTranslation.current = false;
                            setTranslationDraft(null);
                        }}
                        onKeyDown={event => {
                            if (event.key === 'Escape') discardTranslation.current = true;
                            if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
                        }}
                        className={inputClass}
                    />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                    <Field label={t('common:startSeconds')}>
                        <input
                            type="number" step={0.01} value={Number(line.startTime.toFixed(3))}
                            onChange={event => setLineBounds(anchor, line, { startTime: Number(event.target.value) })}
                            className={inputClass}
                        />
                    </Field>
                    <Field label={t('common:endSeconds')}>
                        <input
                            type="number" step={0.01} value={Number(line.endTime.toFixed(3))}
                            onChange={event => setLineBounds(anchor, line, { endTime: Number(event.target.value) })}
                            className={inputClass}
                        />
                    </Field>
                </div>
                <div className="flex gap-1.5">
                    <Button size="sm" onClick={() => seek(line.startTime)}>{t('arrange:menu.jumpHere')}</Button>
                    {hasTiming && <Button size="sm" variant="ghost" onClick={() => resetLineTiming(anchor)}>{t('line.resetTiming')}</Button>}
                    {edit?.text !== undefined && <Button size="sm" variant="ghost" onClick={() => resetLineText(anchor)}>{t('line.resetText')}</Button>}
                    {edit?.translation !== undefined && <Button size="sm" variant="ghost" onClick={() => resetLineTranslation(anchor)}>{t('line.resetTranslation')}</Button>}
                </div>
            </Section>
            <Section title={t('line.segmentation')}>
                {repair && (
                    <div role="alert" className="space-y-1.5 rounded border border-amber-800/70 bg-amber-950/40 px-2 py-1.5 text-xs text-amber-100">
                        <div>{t('line.staleSegmentation')}</div>
                        <div className="text-zinc-300">{t('line.before')}<span className="font-mono">{savedParts?.join('|')}</span></div>
                        <div className="text-zinc-300">{t('line.after')}<span className="font-mono">{repair.join('|')}</span></div>
                        <div className="flex gap-1.5">
                            <Button size="sm" variant="primary" onClick={() => { repairLineSegmentation(anchor, line); setDraft(null); }}>{t('problems:autoRepair')}</Button>
                            <Button size="sm" onClick={() => setDraft(repair.join('|'))}>{t('problems:editManually')}</Button>
                        </div>
                    </div>
                )}
                <Field label={t('line.segmentsLabel')} hint={valid ? t('line.segmentsHint') : t('line.segmentsInvalid')}>
                    <input
                        value={draftText}
                        onChange={event => setDraft(event.target.value)}
                        className={cx(inputClass, !valid && 'border-red-500')}
                    />
                </Field>
                <div className="flex gap-1.5">
                    <Button size="sm" variant="primary" disabled={!valid || draft === null} onClick={() => {
                        setLineSegments(anchor, parts);
                        setDraft(null);
                    }}
                    >
                        {t('line.apply')}
                    </Button>
                    {line.wordSegments && <Button size="sm" variant="ghost" onClick={() => {
                        setLineSegments(anchor, null);
                        setDraft(null);
                    }}
                    >
                        {t('problems:useAutoSegmentation')}
                    </Button>}
                </div>
            </Section>
        </>
    );
}

function ProjectInspector() {
    const direction = useProjectStore(state => state.project.direction);
    const mix = mixAssignment(direction);
    const subtitles = useProjectStore(state => state.project.tuning.kernel.subtitles);
    const program = useProgram();
    const { t } = useTranslation(['inspector', 'arrange']);
    const lockedCount = program.paragraphs.reduce((sum, p) => sum + p.shots.filter(s => s.locked).length, 0);
    return (
        <>
            <Section title={t('project.arrangement')}>
                <Field label={t('project.mode')}>
                    <Segmented<'single' | 'mix'>
                        value={direction.mode}
                        onChange={mode => updateProject(p => ({ ...p, direction: { ...p.direction, mode } }))}
                        options={[{ value: 'single', label: t('project.single') }, { value: 'mix', label: t('project.mix') }]}
                    />
                </Field>
                {direction.mode === 'single' ? (
                    <Field label={t('paragraph.pack')}>
                        <select
                            value={direction.pack}
                            onChange={event => updateProject(p => ({ ...p, direction: { ...p.direction, pack: event.target.value } }))}
                            className={inputClass}
                        >
                            {listPacks().map(pack => <option key={pack.id} value={pack.id}>{packLabel(pack.id)}</option>)}
                        </select>
                    </Field>
                ) : (
                    <Field label={t('project.mixByKind')} hint={t('project.mixByKindHint')}>
                        <div className="space-y-1">
                            {PARAGRAPH_KINDS.map(kind => (
                                <label key={kind} className="flex items-center justify-between gap-2 text-xs text-zinc-400">
                                    <span className="w-14 shrink-0 whitespace-nowrap">{paragraphKindLabel(kind)}</span>
                                    <select
                                        value={mix[kind]}
                                        onChange={event => updateProject(p => ({
                                            ...p,
                                            direction: { ...p.direction, mixByKind: mixOverrides({ ...p.direction.mixByKind, [kind]: event.target.value }) },
                                        }))}
                                        className={cx(inputClass, 'h-7 min-w-0 flex-1')}
                                    >
                                        {listPacks().map(pack => <option key={pack.id} value={pack.id}>{packLabel(pack.id)}</option>)}
                                        {!findPack(mix[kind]) && (
                                            <option value={mix[kind]}>{t('project.notInstalled', { pack: packLabel(mix[kind]) })}</option>
                                        )}
                                    </select>
                                </label>
                            ))}
                            {PARAGRAPH_KINDS.some(kind => mix[kind] !== DEFAULT_MIX_BY_KIND[kind]) && (
                                <Button size="sm" variant="ghost" onClick={() => updateProject(p => ({ ...p, direction: { ...p.direction, mixByKind: {} } }))}>
                                    {t('project.resetMix')}
                                </Button>
                            )}
                        </div>
                    </Field>
                )}
                <Toggle
                    label={t('project.shotMixing')}
                    checked={direction.shotMixing}
                    onChange={shotMixing => updateProject(p => ({ ...p, direction: { ...p.direction, shotMixing } }))}
                />
                <Row label={t('project.counts')}>{program.paragraphs.length} / {program.paragraphs.reduce((sum, p) => sum + p.shots.length, 0)}</Row>
                <Row label={t('project.locked')}>{lockedCount}</Row>
            </Section>
            <Section title={t('project.subtitles')}>
                <Field label={t('project.subtitleLine')}>
                    <Segmented<'translation' | 'romanization' | 'none'>
                        value={subtitles.mode}
                        onChange={mode => updateProject(p => ({ ...p, tuning: { ...p.tuning, kernel: { ...p.tuning.kernel, subtitles: { ...p.tuning.kernel.subtitles, mode } } } }))}
                        options={[{ value: 'translation', label: t('project.subtitleTranslation') }, { value: 'romanization', label: t('project.subtitleRomanization') }, { value: 'none', label: t('project.subtitleNone') }]}
                    />
                </Field>
            </Section>
            <div className="px-4 py-3 text-xs text-zinc-500">{t('project.hint')}</div>
        </>
    );
}

export function Inspector() {
    const selection = useSession(state => state.selection);
    const program = useProgram();
    const { t } = useTranslation(['inspector', 'common']);
    if (selection.type === 'paragraph' || selection.type === 'shot') {
        const paragraph = program.paragraphs.find(item => item.id === selection.paragraphId);
        if (paragraph && selection.type === 'paragraph') return <ParagraphInspector key={paragraph.id} paragraph={paragraph} />;
        const shotId = selection.type === 'shot' ? selection.shotId : null;
        const shot = paragraph?.shots.find(item => item.id === shotId);
        if (paragraph && shot) return <ShotInspector key={shot.id} shot={shot} paragraph={paragraph} />;
        return (
            <div className="space-y-2 px-4 py-3 text-xs text-zinc-500">
                {t('selectionGone')}
                <Button size="sm" onClick={() => setSession({ selection: { type: 'none' } })}>{t('common:clearSelection')}</Button>
            </div>
        );
    }
    if (selection.type === 'line') return <LineInspector key={selection.lineIndex} index={selection.lineIndex} />;
    if (selection.type === 'clip') return <ClipInspector key={selection.clipId} clipId={selection.clipId} />;
    if (selection.type === 'background') return <BackgroundInspector key={selection.clipId} clipId={selection.clipId} />;
    return <ProjectInspector />;
}
