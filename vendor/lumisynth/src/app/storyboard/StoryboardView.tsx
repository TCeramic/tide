// src/app/storyboard/StoryboardView.tsx
// 编辑区「分镜」：大纲的展开视图，主体是一行行歌词。
//   - 左侧的色条标出每行属于哪一段：段号、性质、风格包直接在色条上改；色条顶上的「合并」把这一段并进上一段；
//   - 在歌词上按住拖动（或 Shift + 点击）选中一串行，「切成新段落」让它们自成一段（跨段也可以）；
//   - 点色条的 ▸ 展开这一段：能量、构图族、出场转场，每行后面是从这一行开始的镜头；工具栏可以全部展开。
// 选区与大纲、时间轴、检查器共用；所有修改走已有的编辑动作（进撤销栈，手动的值固定下来，可以交回自动）。
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Dices, Lock, Merge, RotateCcw, Scissors, X } from 'lucide-react';
import { PARAGRAPH_KINDS, type EditOp, type LumiParagraph, type LumiProgram, type LumiShot, type ParagraphDirectionOverride, type ParagraphKind, type PackId, type TransitionId } from '@/compiler/types';
import { findPack, getStyle, getTransition, listPacks } from '@/packs/registry';
import { newId } from '@/project/defaults';
import { setParagraphDirection, setParagraphTransition } from '@/project/edits';
import { setSession, useSession } from '@/project/session';
import { updateProject, useProjectStore } from '@/project/store';
import { isolateLines, mergeWithPrevious, resetParagraphStructure, setParagraphKind } from '@/project/structure';
import { useTranslation } from 'react-i18next';
import { packLabel, packShortLabel, paragraphKindLabel } from '@/i18n/catalog';
import { paragraphMenu, selectParagraph, selectShot, shotMenu, usePlayheadLocation } from '../arrangeActions';
import { useProgram } from '../DerivedProvider';
import { StyleThumb, useThumbnailLook } from '../library/StyleThumb';
import type { ThumbnailLook } from '../library/thumbnails';
import { log } from '../output';
import { seek } from '../playback';
import { packColor } from '../StylePanel';
import { revealInTimeline } from '../timeline/reveal';
import { formatTime } from '../Transport';
import { Button, cx } from '../ui';
import { showContextMenu } from '../workbench/ContextMenu';

const sameLine = (a: { index: number; hash: string }, b: { index: number; hash: string }) => a.index === b.index && a.hash === b.hash;

const selectClass = 'h-6 min-w-0 rounded border border-zinc-700 bg-zinc-900 px-1 text-xs text-zinc-100 outline-none focus:border-amber-400/70';

/** 控件上的点击不要触发外层的「选中这一段 / 这一行」。 */
const stop = (event: MouseEvent | ReactPointerEvent) => event.stopPropagation();

const report = (message: string) => log(message);

// ---------------------------------------------------------------------------------------------
// 展开后的内容

function ShotFrame({ paragraph, shot, look, selected, playing, program }: {
    paragraph: LumiParagraph;
    shot: LumiShot;
    look: ThumbnailLook;
    selected: boolean;
    playing: boolean;
    program: LumiProgram;
}) {
    const style = getStyle(shot.style);
    const number = paragraph.shots.indexOf(shot) + 1;
    const { t } = useTranslation('arrange');
    return (
        <button
            type="button"
            data-storyboard-shot={shot.id}
            title={t(shot.locked ? 'storyboard.shotTitleLocked' : 'storyboard.shotTitleAuto', { shot: `${paragraph.index + 1}.${number}`, style: shot.style, range: `${formatTime(shot.startTime)}–${formatTime(shot.endTime)}` })}
            onPointerDown={stop}
            onClick={event => { stop(event); selectShot(paragraph, shot); }}
            onContextMenu={event => { stop(event); selectShot(paragraph, shot, false); showContextMenu(event, shotMenu(program, paragraph, shot)); }}
            className={cx(
                'w-24 shrink-0 overflow-hidden rounded border text-left',
                selected ? 'border-sky-400 ring-1 ring-sky-400' : playing ? 'border-amber-400/80' : 'border-zinc-800 hover:border-zinc-600',
            )}
        >
            <div className="aspect-video bg-zinc-950"><StyleThumb style={shot.style} look={look} /></div>
            <div className="flex items-center gap-1 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-400">
                <span className="tabular-nums text-zinc-500">{number}</span>
                <span className="truncate">{style?.kind ?? shot.style}</span>
                {shot.locked && <Lock size={9} className="ml-auto shrink-0 text-amber-300" />}
            </div>
        </button>
    );
}

function ParagraphDetails({ paragraph, override, transitionOp, isLast }: {
    paragraph: LumiParagraph;
    override: ParagraphDirectionOverride | undefined;
    transitionOp: EditOp | undefined;
    isLast: boolean;
}) {
    const { direction } = paragraph;
    const families = findPack(direction.pack)?.families ?? [];
    const activeFamilies = direction.families?.filter(id => families.some(family => family.id === id)) ?? null;
    const { t } = useTranslation(['arrange', 'common']);
    return (
        <div className="space-y-1.5 border-b border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400" onPointerDown={stop} onClick={stop}>
            <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5">
                    <input
                        type="checkbox"
                        checked={direction.energy !== null}
                        onChange={event => setParagraphDirection(paragraph, { energy: event.target.checked ? 0.5 : 'auto' })}
                        aria-label={t('storyboard.manualEnergy')}
                    />
                    {t('storyboard.energy')}
                </label>
                {direction.energy === null ? <span className="text-zinc-500">{t('storyboard.energyAuto')}</span> : (
                    <>
                        <input
                            type="range" min={0} max={1} step={0.01}
                            value={direction.energy}
                            onChange={event => setParagraphDirection(paragraph, { energy: Number(event.target.value) })}
                            className="w-28"
                            aria-label={t('storyboard.energy')}
                        />
                        <span className="w-8 tabular-nums text-zinc-200">{direction.energy.toFixed(2)}</span>
                    </>
                )}
                {!isLast && (
                    <>
                        <span className="ml-3">{t('storyboard.transition')}</span>
                        <select
                            value={transitionOp?.type === 'transition' ? transitionOp.transition : 'auto'}
                            onChange={event => setParagraphTransition(paragraph, event.target.value as TransitionId | 'none' | 'auto')}
                            className={cx(selectClass, transitionOp && 'border-amber-400/60')}
                            aria-label={t('pick.paragraphTransition', { n: paragraph.index + 1 })}
                        >
                            <option value="auto">{paragraph.transitionOut && !transitionOp ? t('common:autoValue', { value: getTransition(paragraph.transitionOut.id)?.label ?? paragraph.transitionOut.id }) : t('common:auto')}</option>
                            <option value="none">{t('pick.noTransition')}</option>
                            {listPacks().map(pack => (
                                <optgroup key={pack.id} label={packLabel(pack.id)}>
                                    {pack.transitions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                                </optgroup>
                            ))}
                        </select>
                    </>
                )}
                {override && (
                    <button
                        type="button"
                        onClick={() => setParagraphDirection(paragraph, { pack: 'auto', energy: 'auto', families: 'auto' })}
                        className="ml-auto rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                        <RotateCcw size={11} className="inline" /> {t('storyboard.resetDirection')}
                    </button>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1">{t('storyboard.families')}</span>
                {families.map(family => {
                    const on = activeFamilies?.includes(family.id) ?? false;
                    return (
                        <button
                            key={family.id}
                            type="button"
                            title={family.description}
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
                <span className="text-[11px] text-zinc-500">{activeFamilies ? '' : t('storyboard.familiesAny')}</span>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------------------------
// 左侧色条

function ParagraphBand({ paragraph, program, override, expanded, onToggle, selected, playing }: {
    paragraph: LumiParagraph;
    program: LumiProgram;
    override: ParagraphDirectionOverride | undefined;
    expanded: boolean;
    onToggle: () => void;
    selected: boolean;
    playing: boolean;
}) {
    const color = packColor(paragraph.direction.pack);
    const { t } = useTranslation(['arrange', 'common']);
    const n = paragraph.index + 1;
    return (
        <aside
            data-storyboard-id={paragraph.id}
            aria-label={t('storyboard.paragraph', { n })}
            onClick={() => selectParagraph(paragraph)}
            onContextMenu={event => { selectParagraph(paragraph, false); showContextMenu(event, paragraphMenu(program, paragraph)); }}
            className={cx('group/band relative w-52 shrink-0 cursor-pointer border-r border-zinc-800 py-1.5 pr-2 pl-3', selected ? 'bg-sky-950/50' : 'bg-zinc-900/70 hover:bg-zinc-900')}
            style={{ boxShadow: `inset 4px 0 0 ${color}${playing ? '' : 'cc'}` }}
        >
            {paragraph.index > 0 && (
                <button
                    type="button"
                    onClick={event => { stop(event); mergeWithPrevious(program, paragraph, report); }}
                    title={t('storyboard.mergeHint')}
                    className="absolute -top-2.5 right-2 z-10 flex items-center gap-1 rounded-full border border-zinc-600 bg-zinc-900 px-1.5 py-px text-[10px] text-zinc-300 opacity-0 group-hover/band:opacity-100 hover:border-amber-400 hover:text-amber-200 focus:opacity-100"
                >
                    <Merge size={10} /> {t('storyboard.merge')}
                </button>
            )}
            <div className="sticky top-1 space-y-1">
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        aria-label={expanded ? t('storyboard.collapse', { n }) : t('storyboard.expand', { n })}
                        aria-expanded={expanded}
                        onClick={event => { stop(event); onToggle(); }}
                        className="-ml-1 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                    <span className={cx('w-5 text-sm font-semibold tabular-nums', playing ? 'text-amber-200' : 'text-zinc-100')}>{paragraph.index + 1}</span>
                    <select
                        value={paragraph.kindManual ? paragraph.kind : 'auto'}
                        onClick={stop}
                        onChange={event => setParagraphKind(paragraph, event.target.value as ParagraphKind | 'auto', report)}
                        className={cx(selectClass, 'flex-1', paragraph.kindManual && 'border-amber-400/60')}
                        aria-label={t('storyboard.kindOf', { n })}
                    >
                        <option value="auto">{t('common:autoValue', { value: paragraphKindLabel(paragraph.kind) })}</option>
                        {PARAGRAPH_KINDS.map(kind => <option key={kind} value={kind}>{paragraphKindLabel(kind)}</option>)}
                    </select>
                </div>
                <div className="flex items-center gap-1 pl-5">
                    <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
                    <select
                        value={override?.pack ?? 'auto'}
                        onClick={stop}
                        onChange={event => setParagraphDirection(paragraph, { pack: event.target.value as PackId | 'auto' })}
                        className={cx(selectClass, 'flex-1', override?.pack && 'border-amber-400/60')}
                        aria-label={t('storyboard.packOf', { n })}
                    >
                        <option value="auto">{t('common:autoValue', { value: packShortLabel(paragraph.direction.pack) })}</option>
                        {listPacks().map(pack => <option key={pack.id} value={pack.id}>{packLabel(pack.id)}</option>)}
                    </select>
                </div>
                <div className="flex flex-wrap items-center gap-x-1.5 pl-5 text-[10px] text-zinc-500">
                    <span className="tabular-nums">{formatTime(paragraph.startTime)}</span>
                    <span>{t('storyboard.shotCount', { count: paragraph.shots.length })}</span>
                    {override?.source === 'ai' && <span className="text-amber-300/80">AI</span>}
                    {(paragraph.boundary === 'manual' || paragraph.merged) && (
                        <button
                            type="button"
                            onClick={event => { stop(event); resetParagraphStructure(program, paragraph, report); }}
                            title={t('storyboard.resetStructureHint')}
                            className="text-amber-300/80 hover:text-amber-200 hover:underline"
                        >
                            {paragraph.boundary === 'manual' ? t('storyboard.manualSplit') : t('storyboard.merged')} · {t('storyboard.restoreAuto')}
                        </button>
                    )}
                </div>
            </div>
        </aside>
    );
}

// ---------------------------------------------------------------------------------------------

export function StoryboardView() {
    const program = useProgram();
    const directions = useProjectStore(state => state.project.paragraphDirections);
    const overrides = useProjectStore(state => state.project.overrides);
    const direction = useProjectStore(state => state.project.direction);
    const selection = useSession(state => state.selection);
    const location = usePlayheadLocation(program);
    const look = useThumbnailLook();
    const list = useRef<HTMLDivElement>(null);
    const [allExpanded, setAllExpanded] = useState(false);
    const [toggled, setToggled] = useState<Set<string>>(new Set());
    // 拖选的歌词行：anchor 是按下的那一行，focus 是现在指着的那一行。
    const [range, setRange] = useState<{ anchor: number; focus: number } | null>(null);
    const drag = useRef<{ anchor: number; moved: boolean } | null>(null);
    const { t } = useTranslation(['arrange', 'common']);

    const expanded = (paragraph: LumiParagraph) => allExpanded !== toggled.has(paragraph.id);
    const toggle = (paragraph: LumiParagraph) => setToggled(previous => {
        const next = new Set(previous);
        if (next.has(paragraph.id)) next.delete(paragraph.id);
        else next.add(paragraph.id);
        return next;
    });

    // 别处（大纲、时间轴、剧本）选中了段落 / 镜头：滚到它。
    const selectedId = selection.type === 'shot' || selection.type === 'paragraph' ? selection.paragraphId : null;
    useEffect(() => {
        if (!selectedId) return;
        list.current?.querySelector(`[data-storyboard-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [selectedId]);

    // 分段变了：选中的行可能已经没意义了，清掉。
    useEffect(() => setRange(null), [program.paragraphs.length]);

    const pickLine = useCallback((lineIndex: number) => {
        const item = program.lines[lineIndex];
        if (!item) return;
        setSession({ selection: { type: 'line', lineIndex } });
        seek(item.line.startTime + 0.01);
        revealInTimeline(item.line.startTime, item.renderEndTime);
    }, [program]);

    useEffect(() => {
        const up = () => {
            const current = drag.current;
            drag.current = null;
            if (current && !current.moved) {
                setRange(null);
                pickLine(current.anchor);
            }
        };
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setRange(null); };
        window.addEventListener('pointerup', up);
        window.addEventListener('keydown', escape);
        return () => {
            window.removeEventListener('pointerup', up);
            window.removeEventListener('keydown', escape);
        };
    }, [pickLine]);

    // 普通点击：选中这一行、跳过去；拖到别的行才出选区（拖回来可以只选一行）；Shift + 点击从上一次的行扩展。
    const onLineDown = (event: ReactPointerEvent, lineIndex: number) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const from = range?.anchor ?? (selection.type === 'line' ? selection.lineIndex : null);
        if (event.shiftKey && from !== null) {
            setRange({ anchor: from, focus: lineIndex });
            drag.current = { anchor: from, moved: true };
            return;
        }
        drag.current = { anchor: lineIndex, moved: false };
    };
    const onLineEnter = (lineIndex: number) => {
        const current = drag.current;
        if (!current) return;
        if (lineIndex === current.anchor && !current.moved) return;
        current.moved = true;
        setRange({ anchor: current.anchor, focus: lineIndex });
    };

    if (program.paragraphs.length === 0) {
        return <div className="px-4 py-3 text-xs text-zinc-500">{t('storyboard.empty')}</div>;
    }

    const from = range ? Math.min(range.anchor, range.focus) : -1;
    const to = range ? Math.max(range.anchor, range.focus) : -1;
    const exactParagraph = range ? program.paragraphs.find(paragraph => paragraph.lineIndices[0] === from && paragraph.lineIndices.at(-1) === to) : undefined;
    const spanned = range ? program.paragraphs.filter(paragraph => paragraph.lineIndices.some(index => index >= from && index <= to)).length : 0;
    const selectedShot = selection.type === 'shot' ? selection.shotId : null;
    const selectedLine = selection.type === 'line' ? selection.lineIndex : null;
    const shots = program.paragraphs.reduce((sum, paragraph) => sum + paragraph.shots.length, 0);

    return (
        <div data-testid="storyboard" className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2 text-xs">
                <span className="text-sm text-zinc-100">{t('storyboard.title')}</span>
                <span className="text-zinc-500">{t('storyboard.paragraphCount', { count: program.paragraphs.length })} · {t('storyboard.lineCount', { count: program.lines.length })} · {t('storyboard.shotCount', { count: shots })}</span>
                <div className="mx-1 h-4 w-px bg-zinc-800" />
                <select
                    value={direction.mode === 'mix' ? 'mix' : direction.pack}
                    onChange={event => {
                        const value = event.target.value;
                        updateProject(p => ({ ...p, direction: value === 'mix' ? { ...p.direction, mode: 'mix' } : { ...p.direction, mode: 'single', pack: value } }));
                    }}
                    className={cx(selectClass, 'h-7')}
                    aria-label={t('storyboard.songPack')}
                >
                    {listPacks().map(pack => <option key={pack.id} value={pack.id}>{t('storyboard.songUses', { pack: packLabel(pack.id) })}</option>)}
                    <option value="mix">{t('storyboard.songMix')}</option>
                </select>
                <Button size="sm" variant="ghost" onClick={() => updateProject(p => ({ ...p, seed: newId().slice(0, 8) }))} title={t('storyboard.reseedHint')}>
                    <Dices size={12} /> {t('storyboard.reseed')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setAllExpanded(!allExpanded); setToggled(new Set()); }}>
                    {allExpanded ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />} {allExpanded ? t('storyboard.collapseAll') : t('storyboard.expandAll')}
                </Button>
                <span className="ml-auto text-[11px] text-zinc-500">{t('storyboard.hint')}</span>
            </div>

            <div ref={list} className="min-h-0 flex-1 overflow-y-auto select-none">
                <div className="mx-auto max-w-5xl py-3">
                    {program.paragraphs.map(paragraph => {
                        const open = expanded(paragraph);
                        const isLast = paragraph.index === program.paragraphs.length - 1;
                        const override = directions.find(item => sameLine(item.anchor.line, paragraph.anchor.line));
                        const transitionOp = overrides.find(op => op.type === 'transition' && sameLine(op.anchor.line, paragraph.anchor.line));
                        const bridge = paragraph.shots.filter(shot => shot.isBridge);
                        return (
                            <div key={paragraph.id} className="flex border-t border-zinc-800 first:border-t-0">
                                <ParagraphBand
                                    paragraph={paragraph}
                                    program={program}
                                    override={override}
                                    expanded={open}
                                    onToggle={() => toggle(paragraph)}
                                    selected={selection.type === 'paragraph' && selection.paragraphId === paragraph.id}
                                    playing={location.paragraphId === paragraph.id}
                                />
                                <div className="min-w-0 flex-1">
                                    {open && <ParagraphDetails paragraph={paragraph} override={override} transitionOp={transitionOp} isLast={isLast} />}
                                    {paragraph.lineIndices.map(lineIndex => {
                                        const item = program.lines[lineIndex];
                                        const inRange = lineIndex >= from && lineIndex <= to;
                                        const lineShots = open ? paragraph.shots.filter(shot => !shot.isBridge && shot.anchor.line.index === lineIndex) : [];
                                        return (
                                            <div
                                                key={lineIndex}
                                                data-storyboard-line={lineIndex}
                                                onPointerDown={event => onLineDown(event, lineIndex)}
                                                onPointerEnter={() => onLineEnter(lineIndex)}
                                                className={cx(
                                                    'flex min-h-8 cursor-text items-center gap-3 px-3 py-1',
                                                    inRange ? 'bg-amber-400/15' : selectedLine === lineIndex ? 'bg-sky-950/50' : 'hover:bg-zinc-900/70',
                                                )}
                                            >
                                                <span className="w-16 shrink-0 text-[10px] text-zinc-500 tabular-nums">{lineIndex + 1} · {formatTime(item.line.startTime)}</span>
                                                <span className="min-w-0 flex-1 text-sm text-zinc-200">{item.line.fullText}</span>
                                                {lineShots.length > 0 && (
                                                    <div className="flex max-w-[55%] flex-wrap justify-end gap-1.5 py-0.5">
                                                        {lineShots.map(shot => (
                                                            <ShotFrame key={shot.id} paragraph={paragraph} shot={shot} look={look} program={program}
                                                                selected={selectedShot === shot.id} playing={location.shotId === shot.id} />
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {open && bridge.length > 0 && (
                                        <div className="flex items-center gap-3 px-3 py-1">
                                            <span className="w-16 shrink-0" />
                                            <span className="flex-1 text-xs text-zinc-500">{t('storyboard.bridge')}</span>
                                            <div className="flex flex-wrap justify-end gap-1.5">
                                                {bridge.map(shot => (
                                                    <ShotFrame key={shot.id} paragraph={paragraph} shot={shot} look={look} program={program}
                                                        selected={selectedShot === shot.id} playing={location.shotId === shot.id} />
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {range && (
                <div role="toolbar" aria-label={t('storyboard.selectedLyrics')} className="flex shrink-0 flex-wrap items-center gap-2 border-t border-amber-900/60 bg-amber-950/40 px-4 py-2 text-xs text-amber-100">
                    <span>
                        {t('storyboard.selected', { lines: to > from ? `${from + 1}–${to + 1}` : `${from + 1}`, count: to - from + 1 })}
                        {spanned > 1 ? t('storyboard.selectedSpan', { count: spanned }) : ''}
                    </span>
                    {exactParagraph ? <span className="text-amber-200/70">{t('storyboard.exactParagraph', { n: exactParagraph.index + 1 })}</span> : (
                        <Button size="sm" variant="primary" onClick={() => { if (isolateLines(program, from, to, report)) setRange(null); }}>
                            <Scissors size={12} /> {t('storyboard.isolate')}
                        </Button>
                    )}
                    <div className="flex-1" />
                    <span className="text-amber-200/60">{t('storyboard.rangeHint')}</span>
                    <Button size="sm" variant="ghost" onClick={() => setRange(null)} aria-label={t('common:clearSelection')}><X size={12} /></Button>
                </div>
            )}
        </div>
    );
}
