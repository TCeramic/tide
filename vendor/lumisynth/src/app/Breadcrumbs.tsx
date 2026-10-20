// src/app/Breadcrumbs.tsx
// 预览上方的面包屑（VS Code 编辑器顶部那条）：段落 › 镜头。有选区时显示选区，否则显示播放头所在处；
// 点任一段弹出快速选择，在同级之间跳转。
import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { getStyle } from '@/packs/registry';
import { useSession } from '@/project/session';
import { useTranslation } from 'react-i18next';
import { packShortLabel, paragraphKindLabel } from '@/i18n/catalog';
import { selectParagraph, selectShot, shotText, usePlayheadLocation } from './arrangeActions';
import { useProgram } from './DerivedProvider';
import { formatTime } from './Transport';
import { showQuickPick } from './workbench/QuickPick';

export function Breadcrumbs() {
    const program = useProgram();
    const selection = useSession(state => state.selection);
    const location = usePlayheadLocation(program);
    const { t } = useTranslation('workbench');

    const { paragraph, shot } = useMemo(() => {
        if (selection.type === 'shot' || selection.type === 'paragraph') {
            const p = program.paragraphs.find(item => item.id === selection.paragraphId) ?? null;
            const s = selection.type === 'shot' ? p?.shots.find(item => item.id === selection.shotId) ?? null : null;
            if (p) return { paragraph: p, shot: s };
        }
        const p = program.paragraphs.find(item => item.id === location.paragraphId) ?? program.paragraphs[0] ?? null;
        const s = p?.shots.find(item => item.id === location.shotId) ?? null;
        return { paragraph: p, shot: s };
    }, [program, selection, location.paragraphId, location.shotId]);

    if (!paragraph) return <div className="h-6 shrink-0 border-b border-zinc-800 bg-zinc-950" />;

    const pickParagraph = async () => {
        const chosen = await showQuickPick(program.paragraphs.map(item => ({
            label: `${item.index + 1}. ${paragraphKindLabel(item.kind)} · ${packShortLabel(item.direction.pack)}`,
            description: formatTime(item.startTime),
            value: item,
            picked: item.id === paragraph.id,
        })), { title: t('breadcrumbs.jumpToParagraph') });
        if (chosen) selectParagraph(chosen);
    };

    const pickShot = async () => {
        const chosen = await showQuickPick(paragraph.shots.map(item => ({
            label: getStyle(item.style)?.kind ?? item.style,
            description: shotText(program, item).slice(0, 36),
            value: item,
            thumbnail: item.style,
            picked: item.id === shot?.id,
        })), { title: t('breadcrumbs.shotsOf', { n: paragraph.index + 1 }) });
        if (chosen) selectShot(paragraph, chosen);
    };

    const crumb = 'rounded px-1 hover:bg-zinc-800 hover:text-zinc-100';
    return (
        <nav aria-label={t('breadcrumbs.label')} className="flex h-6 shrink-0 items-center gap-0.5 overflow-hidden border-b border-zinc-800 bg-zinc-950 px-2 text-[11px] whitespace-nowrap text-zinc-400">
            <span className="px-1 text-zinc-500">{t('breadcrumbs.song')}</span>
            <ChevronRight size={12} className="shrink-0 text-zinc-600" />
            <button type="button" onClick={() => void pickParagraph()} className={crumb}>
                {paragraph.index + 1}. {paragraphKindLabel(paragraph.kind)} · {packShortLabel(paragraph.direction.pack)}
            </button>
            {shot && (
                <>
                    <ChevronRight size={12} className="shrink-0 text-zinc-600" />
                    <button type="button" onClick={() => void pickShot()} className={crumb}>
                        {getStyle(shot.style)?.kind ?? shot.style}
                    </button>
                    <span className="truncate pl-1 text-zinc-600">{shotText(program, shot)}</span>
                </>
            )}
        </nav>
    );
}
