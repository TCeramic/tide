// src/app/views/OutlineView.tsx
// 主侧栏「大纲」：段落 → 镜头的树（VS Code 的 Outline）。与时间轴、检查器共用选区；
// 播放头所在的段落与镜头加粗；右键菜单与时间轴相同。
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Clapperboard, Lock } from 'lucide-react';
import type { LumiParagraph, LumiShot } from '@/compiler/types';
import { getStyle } from '@/packs/registry';
import { useSession } from '@/project/session';
import { useTranslation } from 'react-i18next';
import { packShortLabel, paragraphKindLabel } from '@/i18n/catalog';
import { paragraphMenu, selectParagraph, selectShot, shotMenu, shotText, usePlayheadLocation } from '../arrangeActions';
import { useProgram } from '../DerivedProvider';
import { packColor } from '../StylePanel';
import { formatTime } from '../Transport';
import { cx } from '../ui';
import { showContextMenu } from '../workbench/ContextMenu';
import { executeCommand } from '../workbench/commands';

export function OutlineView() {
    const program = useProgram();
    const selection = useSession(state => state.selection);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const list = useRef<HTMLDivElement>(null);
    const { t } = useTranslation('arrange');

    const location = usePlayheadLocation(program);
    const playing = { paragraph: location.paragraphId, shot: location.shotId };

    const selectedId = selection.type === 'shot' ? selection.shotId : selection.type === 'paragraph' ? selection.paragraphId : null;
    useEffect(() => {
        if (!selectedId) return;
        list.current?.querySelector(`[data-outline-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [selectedId]);

    if (program.paragraphs.length === 0) return <div className="px-4 py-3 text-xs text-zinc-500">{t('outline.empty')}</div>;

    const toggle = (id: string) => setCollapsed(previous => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });

    const paragraphRow = (paragraph: LumiParagraph) => {
        const open = !collapsed.has(paragraph.id);
        const selected = selection.type === 'paragraph' && selection.paragraphId === paragraph.id;
        return (
            <div
                data-outline-id={paragraph.id}
                role="treeitem"
                aria-expanded={open}
                aria-selected={selected}
                onClick={() => selectParagraph(paragraph)}
                onContextMenu={event => {
                    selectParagraph(paragraph, false);
                    showContextMenu(event, paragraphMenu(program, paragraph));
                }}
                className={cx('flex h-6 cursor-pointer items-center gap-1 pr-2 pl-1 text-xs pointer-coarse:h-11 pointer-coarse:text-sm', selected ? 'bg-sky-900/50 text-zinc-50' : 'text-zinc-300 hover:bg-zinc-800/60')}
            >
                <button type="button" aria-label={open ? t('outline.collapse') : t('outline.expand')} onClick={event => { event.stopPropagation(); toggle(paragraph.id); }} className="text-zinc-500">
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: packColor(paragraph.direction.pack) }} />
                <span className={cx('truncate', playing.paragraph === paragraph.id && 'font-semibold text-zinc-50')}>
                    {paragraph.index + 1}. {paragraphKindLabel(paragraph.kind)} · {packShortLabel(paragraph.direction.pack)}
                </span>
                {paragraph.direction.source !== 'auto' && <span className="text-[10px] text-zinc-500">{paragraph.direction.source === 'ai' ? 'AI' : t('outline.manual')}</span>}
                {(paragraph.boundary === 'manual' || paragraph.merged || paragraph.kindManual) && (
                    <span className="text-[10px] text-amber-300/80" title={[paragraph.boundary === 'manual' && t('outline.manualSplit'), paragraph.merged && t('outline.manualMerge'), paragraph.kindManual && t('outline.manualKind')].filter(Boolean).join(t('outline.separator'))}>
                        {paragraph.boundary === 'manual' ? '✂' : ''}{paragraph.merged ? '⧉' : ''}{paragraph.kindManual ? '✎' : ''}
                    </span>
                )}
                <span className="ml-auto shrink-0 text-[10px] text-zinc-500 tabular-nums">{formatTime(paragraph.startTime)}</span>
            </div>
        );
    };

    const shotRow = (paragraph: LumiParagraph, shot: LumiShot) => {
        const selected = selection.type === 'shot' && selection.shotId === shot.id;
        return (
            <div
                key={shot.id}
                data-outline-id={shot.id}
                role="treeitem"
                aria-selected={selected}
                onClick={() => selectShot(paragraph, shot)}
                onContextMenu={event => {
                    selectShot(paragraph, shot, false);
                    showContextMenu(event, shotMenu(program, paragraph, shot));
                }}
                title={shotText(program, shot)}
                className={cx('flex h-6 cursor-pointer items-center gap-1.5 pr-2 pl-8 text-xs pointer-coarse:h-11 pointer-coarse:text-sm', selected ? 'bg-sky-900/50 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-800/60')}
            >
                {shot.locked ? <Lock size={10} className="shrink-0 text-amber-300" /> : <span className="w-2.5 shrink-0" />}
                <span className={cx('shrink-0', playing.shot === shot.id ? 'font-semibold text-zinc-50' : 'text-zinc-300')}>{getStyle(shot.style)?.kind ?? shot.style}</span>
                <span className="truncate text-zinc-500">{shotText(program, shot)}</span>
            </div>
        );
    };

    return (
        <>
            <button
                type="button"
                onClick={() => executeCommand('view.storyboard')}
                title={t('outline.openStoryboardHint')}
                className="mx-2 mt-1.5 flex w-[calc(100%-1rem)] items-center justify-center gap-1.5 rounded-md border border-zinc-700 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-zinc-50"
            >
                <Clapperboard size={12} /> {t('outline.openStoryboard')}
            </button>
            <div ref={list} role="tree" aria-label={t('outline.label')} className="py-1">
                {program.paragraphs.map(paragraph => (
                    <div key={paragraph.id}>
                        {paragraphRow(paragraph)}
                        {!collapsed.has(paragraph.id) && paragraph.shots.map(shot => shotRow(paragraph, shot))}
                    </div>
                ))}
            </div>
        </>
    );
}
