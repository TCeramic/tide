// src/app/lyrics/LyricsView.tsx
// 编辑区「歌词」标签页：听着歌改歌词。上面是行列表（双击一行改字），下面是选中那一行的逐字条。
// - 播放本行 / 循环 / 慢速试听（0.5×、0.75×，只影响试听）；
// - 逐字条上拖动调逐字时间（见 WordStrip），吸附起音点与播放头；
// - 打点：从行首前 1 秒开始播放，每按一次空格定下一个字的开始，最后一下定结束，Esc 放弃；
// - 均分 / 按字数分配 / 拆成单字 / 与下一个合并 / 恢复原始时间 / 恢复原文；
// - 键盘：←/→ 选字，[ ] 把选中字的开始挪 10ms（Shift 50ms），Enter 播放选中的字；
// - 改字导致手动分词对不上时提示「自动修复」「手动修改」。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AlertTriangle, Pause, Play, Repeat, Scissors, Timer, Undo2 } from 'lucide-react';
import { anchorOfLine } from '@/core/lyrics/edits';
import { isValidWordSegmentation } from '@/core/lyrics/wordSegmentation';
import { applyTaps, distribute, dragUnitEdge, editableUnits, mergeWithNext, splitUnit, type Bounds, type WordEdit } from '@/core/lyrics/wordEditing';
import type { TimedUnit } from '@/core/lyrics/wordTiming';
import type { Line } from '@/core/types';
import type { LineAnchor } from '@/core/lyrics/edits';
import {
    repairLineSegmentation,
    resetLineText,
    resetLineTiming,
    segmentationRepairFor,
    setLineSegments,
    setLineText,
    setLineWords,
} from '@/project/lyrics';
import { setSession, useSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { useEffectiveLyrics } from '../DerivedProvider';
import { log } from '../output';
import { clock, setPlaybackRate, usePlayback } from '../playback';
import { Button, cx, inputClass, Segmented } from '../ui';
import { playRange, setRangeLoop, stopRange, useRangePlayback } from './rangePlayback';
import { formatMs, WordStrip } from './WordStrip';
import { useTranslation } from 'react-i18next';
import { t as translate } from '@/i18n';

const lineIndexAt = (lines: Line[], time: number) => {
    let found = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].startTime <= time) found = i;
        else break;
    }
    return found;
};

interface TapState {
    index: number;
    anchor: LineAnchor;
    line: Line;
    units: TimedUnit[];
    bounds: Bounds;
    limit: Bounds;
    taps: number[];
}

function LineText({ line, onCommit }: { line: Line; onCommit: (text: string) => void }) {
    const [draft, setDraft] = useState<string | null>(null);
    const { t } = useTranslation('song');
    if (draft === null) {
        return (
            <span
                onDoubleClick={event => { event.stopPropagation(); setDraft(line.fullText); }}
                title={t('lyrics.doubleClickToEdit')}
                className="min-w-0 flex-1 truncate text-zinc-100"
            >
                {line.fullText}
            </span>
        );
    }
    const commit = () => {
        if (draft.trim() && draft !== line.fullText) onCommit(draft);
        setDraft(null);
    };
    return (
        <input
            autoFocus
            aria-label={t('lyrics.editLine')}
            value={draft}
            onClick={event => event.stopPropagation()}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
                event.stopPropagation();
                if (event.key === 'Enter') commit();
                if (event.key === 'Escape') setDraft(null);
            }}
            onBlur={commit}
            className={cx(inputClass, 'h-7 min-w-0 flex-1 select-text')}
        />
    );
}

function SegmentationPrompt({ anchor, line }: { anchor: LineAnchor; line: Line }) {
    // 选原始数据（引用稳定），修复结果在外面算：选择器每次返回新数组会让 zustand 反复重渲染。
    const project = useProjectStore(state => state.project);
    const repair = useMemo(() => segmentationRepairFor(project, anchor, line), [project, anchor, line]);
    const saved = useProjectStore(state => state.project.lyricEdits.segments.find(item => item.anchor.index === anchor.index && item.anchor.hash === anchor.hash)?.parts);
    const [draft, setDraft] = useState<string | null>(null);
    const { t } = useTranslation(['inspector', 'problems', 'common', 'song']);
    if (!repair) return null;
    const parts = draft?.split('|') ?? repair;
    const valid = isValidWordSegmentation(line.fullText, parts);
    return (
        <div role="alert" data-testid="segmentation-prompt" className="space-y-1.5 rounded border border-amber-800/70 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
            <div className="flex items-center gap-1.5"><AlertTriangle size={13} /> {t('line.staleSegmentation')}</div>
            <div className="text-zinc-300">{t('line.before')}<span className="font-mono">{saved?.join('|')}</span></div>
            {draft === null ? (
                <>
                    <div className="text-zinc-300">{t('song:lyrics.repaired')}<span className="font-mono">{repair.join('|')}</span></div>
                    <div className="flex gap-1.5">
                        <Button size="sm" variant="primary" onClick={() => repairLineSegmentation(anchor, line)}>{t('problems:autoRepair')}</Button>
                        <Button size="sm" onClick={() => setDraft(repair.join('|'))}>{t('problems:editManually')}</Button>
                    </div>
                </>
            ) : (
                <div className="flex items-center gap-1.5">
                    <input
                        autoFocus
                        aria-label={t('line.segmentation')}
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        onKeyDown={event => event.stopPropagation()}
                        className={cx(inputClass, 'h-7 flex-1 font-mono select-text', !valid && 'border-red-500')}
                    />
                    <Button size="sm" variant="primary" disabled={!valid} onClick={() => { setLineSegments(anchor, parts); setDraft(null); }}>{t('line.apply')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>{t('common:cancel')}</Button>
                </div>
            )}
        </div>
    );
}

export function LyricsView() {
    const { data, invalidEdits } = useEffectiveLyrics();
    const { t } = useTranslation(['song', 'inspector']);
    const lines = useMemo(() => data?.lines ?? [], [data]);
    const lineEdits = useProjectStore(state => state.project.lyricEdits.lines);
    const selection = useSession(state => state.selection);
    const playheadIndex = usePlayback(state => lineIndexAt(lines, state.time));
    const duration = usePlayback(state => state.duration);
    const rate = usePlayback(state => state.rate);
    const playing = usePlayback(state => state.playing);
    const range = useRangePlayback(state => state.range);
    const [loop, setLoop] = useState(false);
    const [snap, setSnap] = useState(true);
    const [selectedUnit, setSelectedUnit] = useState<number | null>(null);
    const [tap, setTap] = useState<TapState | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const stripRef = useRef<HTMLDivElement>(null);

    const index = selection.type === 'line' && lines[selection.lineIndex] ? selection.lineIndex : Math.max(0, playheadIndex);
    const line = lines[index] as Line | undefined;
    const anchor = line ? anchorOfLine(line, index) : null;
    const limit: Bounds = {
        start: index > 0 ? lines[index - 1].startTime + 0.05 : 0,
        end: index + 1 < lines.length ? lines[index + 1].endTime - 0.05 : Math.max(duration, (line?.endTime ?? 0) + 5),
    };
    const modified = useMemo(() => new Set(lineEdits.map(edit => edit.anchor.index)), [lineEdits]);
    const staleSegments = useMemo(() => new Set(invalidEdits.filter(edit => edit.kind === 'segments' && edit.reason === 'invalid-segmentation').map(edit => edit.anchor.index)), [invalidEdits]);
    const edit = line ? lineEdits.find(item => item.anchor.index === index && item.anchor.hash === anchor!.hash) : undefined;

    useEffect(() => { setSelectedUnit(null); }, [index]);
    useEffect(() => {
        listRef.current?.querySelector(`[data-line-row="${index}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [index]);
    // 离开面板时恢复正常速度。
    useEffect(() => () => setPlaybackRate(1), []);

    const selectLine = (next: number) => setSession({ selection: { type: 'line', lineIndex: next } });

    const apply = (result: WordEdit) => {
        if (!line || !anchor) return;
        setLineWords(anchor, line, result.units, { startTime: result.bounds.start, endTime: result.bounds.end });
    };
    const units = line ? editableUnits(line) : [];
    const bounds: Bounds = line ? { start: line.startTime, end: line.endTime } : { start: 0, end: 0 };

    // ---- 打点
    const finishTap = (state: TapState | null, commit: boolean) => {
        setTap(null);
        stopRange();
        if (!state || !commit || state.taps.length === 0) return;
        const result = applyTaps(state.units, state.bounds, state.taps, state.limit);
        setLineWords(state.anchor, state.line, result.units, { startTime: result.bounds.start, endTime: result.bounds.end });
        log(translate('song:lyrics.tapDone', { n: state.index + 1, done: Math.min(state.taps.length, state.units.length), count: state.units.length }));
    };
    const tapRef = useRef(tap);
    tapRef.current = tap;
    const startTap = () => {
        if (!line || !anchor) return;
        const state: TapState = { index, anchor, line, units, bounds, limit, taps: [] };
        setTap(state);
        playRange(line.startTime - 1, Math.min(limit.end, line.endTime + 2));
        stripRef.current?.focus();
    };
    useEffect(() => {
        if (!tap) return;
        const onKey = (event: KeyboardEvent) => {
            const current = tapRef.current;
            if (!current) return;
            if (event.code === 'Space') {
                event.preventDefault();
                event.stopPropagation();
                if (event.repeat) return;
                const taps = [...current.taps, clock.get()];
                if (taps.length >= current.units.length + 1) finishTap({ ...current, taps }, true);
                else setTap({ ...current, taps });
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                finishTap(current, false);
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [Boolean(tap)]);
    // 播完了还没打完：保留已经打的。
    useEffect(() => {
        if (tapRef.current && !range) finishTap(tapRef.current, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range]);
    const tapPreview = tap ? applyTaps(tap.units, tap.bounds, tap.taps, tap.limit).units : null;

    // ---- 键盘
    const onStripKey = (event: ReactKeyboardEvent) => {
        if (tap || !line) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            const step = event.key === 'ArrowLeft' ? -1 : 1;
            setSelectedUnit(current => Math.max(0, Math.min(units.length - 1, (current ?? (step > 0 ? -1 : units.length)) + step)));
        } else if ((event.code === 'BracketLeft' || event.code === 'BracketRight') && selectedUnit !== null) {
            event.preventDefault();
            event.stopPropagation();
            const delta = (event.code === 'BracketLeft' ? -1 : 1) * (event.shiftKey ? 0.05 : 0.01);
            apply(dragUnitEdge(units, bounds, selectedUnit, 'start', units[selectedUnit].startTime + delta, { limit }));
        } else if (event.key === 'Enter' && selectedUnit !== null) {
            event.preventDefault();
            event.stopPropagation();
            const unit = units[selectedUnit];
            playRange(unit.startTime - 0.05, unit.endTime + 0.05);
        }
    };

    if (!data) {
        return <div className="p-6 text-sm text-zinc-500 select-none">{t('lyrics.importFirst')}</div>;
    }

    const lineRange = line ? { start: line.startTime - 0.3, end: line.endTime + 0.2 } : null;
    const playingLine = Boolean(range && lineRange && Math.abs(range.start - lineRange.start) < 0.01);

    return (
        <div className="flex min-h-0 flex-1 flex-col select-none" data-testid="lyrics-view">
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-zinc-800 px-3 py-1.5">
                <Button
                    size="sm"
                    disabled={!line || Boolean(tap)}
                    onClick={() => (playingLine && playing ? stopRange() : lineRange && playRange(lineRange.start, lineRange.end, loop))}
                    title={t('lyrics.playLineHint')}
                >
                    {playingLine && playing ? <Pause size={12} /> : <Play size={12} />} {t('lyrics.playLine')}
                </Button>
                <Button size="sm" variant={loop ? 'primary' : 'ghost'} aria-pressed={loop} onClick={() => { setLoop(!loop); setRangeLoop(!loop); }} title={t('lyrics.loopHint')}>
                    <Repeat size={12} /> {t('lyrics.loop')}
                </Button>
                <Segmented<string>
                    value={String(rate)}
                    onChange={value => setPlaybackRate(Number(value))}
                    options={[{ value: '0.5', label: '0.5×' }, { value: '0.75', label: '0.75×' }, { value: '1', label: '1×' }]}
                />
                <Button size="sm" variant={snap ? 'primary' : 'ghost'} aria-pressed={snap} onClick={() => setSnap(!snap)} title={t('lyrics.snapHint')}>{t('lyrics.snap')}</Button>
                <Button size="sm" variant={tap ? 'primary' : 'default'} disabled={!line} onClick={() => (tap ? finishTap(tap, true) : startTap())} title={t('lyrics.tapHint')}>
                    <Timer size={12} /> {tap ? t('lyrics.tapStop') : t('lyrics.tap')}
                </Button>
                <div className="mx-1 h-4 w-px bg-zinc-800" />
                <Button size="sm" variant="ghost" disabled={!line || Boolean(tap)} onClick={() => apply(distribute(units, bounds, 'even'))}>{t('lyrics.even')}</Button>
                <Button size="sm" variant="ghost" disabled={!line || Boolean(tap)} onClick={() => apply(distribute(units, bounds, 'length'))}>{t('lyrics.byLength')}</Button>
                <Button size="sm" variant="ghost" disabled={selectedUnit === null || Boolean(tap)} onClick={() => selectedUnit !== null && apply(splitUnit(units, bounds, selectedUnit))} title={t('lyrics.splitHint')}>
                    <Scissors size={12} /> {t('lyrics.split')}
                </Button>
                <Button size="sm" variant="ghost" disabled={selectedUnit === null || selectedUnit >= units.length - 1 || Boolean(tap)} onClick={() => selectedUnit !== null && apply(mergeWithNext(units, bounds, selectedUnit))}>{t('lyrics.mergeNext')}</Button>
                <div className="mx-1 h-4 w-px bg-zinc-800" />
                <Button size="sm" variant="ghost" disabled={!edit || (edit.startTime === undefined && !edit.words) || Boolean(tap)} onClick={() => anchor && resetLineTiming(anchor)}>
                    <Undo2 size={12} /> {t('inspector:line.resetTiming')}
                </Button>
                <Button size="sm" variant="ghost" disabled={edit?.text === undefined || Boolean(tap)} onClick={() => anchor && resetLineText(anchor)}>{t('inspector:line.resetText')}</Button>
            </div>

            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1 text-[13px]" role="listbox" aria-label={t('lyrics.lines')}>
                {lines.map((item, i) => (
                    <div
                        key={i}
                        role="option"
                        aria-selected={i === index}
                        data-line-row={i}
                        onClick={() => { selectLine(i); if (!tap) stopRange(); }}
                        className={cx(
                            'flex cursor-pointer items-center gap-2 px-3 py-1',
                            i === index ? 'bg-sky-900/40' : 'hover:bg-zinc-900',
                            i === playheadIndex && 'shadow-[inset_2px_0_0_#6ee7b7]',
                        )}
                    >
                        <span className="w-8 shrink-0 text-right text-[11px] text-zinc-600">{i + 1}</span>
                        <span className="w-20 shrink-0 font-mono text-[11px] text-zinc-500">{formatMs(item.startTime).slice(0, -2)}</span>
                        <LineText line={item} onCommit={text => setLineText(anchorOfLine(item, i), item, text)} />
                        {modified.has(i) && <span title={t('lyrics.modified')} className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
                        {staleSegments.has(i) && <span title={t('lyrics.staleSegmentation')}><AlertTriangle size={13} className="shrink-0 text-amber-400" /></span>}
                    </div>
                ))}
            </div>

            {line && anchor && (
                <div className="shrink-0 space-y-2 border-t border-zinc-800 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span className="text-zinc-200">{t('inspector:line.numbered', { n: index + 1 })}</span>
                        {selectedUnit !== null && units[selectedUnit] && (
                            <span data-testid="unit-readout">
                                {t('lyrics.unitInfo', { text: units[selectedUnit].text, start: formatMs(units[selectedUnit].startTime), duration: (units[selectedUnit].endTime - units[selectedUnit].startTime).toFixed(3) })}
                            </span>
                        )}
                        <div className="flex-1" />
                        <span className="text-zinc-600">{t('lyrics.keysHint')}</span>
                    </div>
                    {tap && (
                        <div role="status" className="rounded border border-emerald-800/70 bg-emerald-950/40 px-3 py-1.5 text-xs text-emerald-100">
                            {t('lyrics.tapping', { done: Math.min(tap.taps.length, tap.units.length), count: tap.units.length })}
                            {tap.taps.length < tap.units.length && <span className="ml-2 font-medium">{t('lyrics.tapNext', { text: tap.units[tap.taps.length].text })}</span>}
                        </div>
                    )}
                    <div ref={stripRef} tabIndex={0} onKeyDown={onStripKey} className="outline-none focus-visible:ring-1 focus-visible:ring-sky-600">
                        <WordStrip
                            line={line}
                            anchor={anchor}
                            limit={limit}
                            selected={selectedUnit}
                            onSelect={unit => { setSelectedUnit(unit); stripRef.current?.focus(); }}
                            snap={snap}
                            preview={tapPreview}
                            disabled={Boolean(tap)}
                        />
                    </div>
                    <SegmentationPrompt anchor={anchor} line={line} />
                </div>
            )}
        </div>
    );
}
