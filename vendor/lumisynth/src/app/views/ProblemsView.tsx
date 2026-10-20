// src/app/views/ProblemsView.tsx
// 「问题」面板：失效的歌词修改、失效的编排修改（EditOp）。失效项不会被悄悄丢掉，而是列在这里。
import { useProjectStore } from '@/project/store';
import { repairLineSegmentation } from '@/project/lyrics';
import { setSession, useSession } from '@/project/session';
import { resolveAssetClips } from '@/core/assets/clips';
import { removeAssetClip, removeBackgroundClip } from '@/project/assets';
import { resolveBackgroundClips } from '@/core/assets/background';
import { AlertTriangle } from 'lucide-react';
import type { InvalidEdit } from '@/core/lyrics/edits';
import { updateProject } from '@/project/store';
import type { InvalidEditOp } from '@/compiler/types';
import { useEffectiveLyrics, useProgram } from '../DerivedProvider';
import { useTranslation } from 'react-i18next';

export interface Problem {
    key: string;
    message: string;
    detail: string;
    remove: () => void;
    /** 按钮上的字（默认「删除这条修改」）。 */
    action?: string;
    /** 排在删除前面的其他操作（比如自动修复）。 */
    extra?: Array<{ label: string; run: () => void }>;
}

export const useProblems = (): Problem[] => {
    const program = useProgram();
    const lyricProblems = useLyricProblems();
    const { t } = useTranslation('problems');
    const opReason = (reason: InvalidEditOp['reason']) => t(`opReasons.${reason}`);
    const opProblems: Problem[] = program.invalidOps.filter(({ op }) => !op.id.startsWith('peek-')).map(({ op, reason }) => ({
        key: `op-${op.id}`,
        message: op.type === 'shot-style'
            ? t('shotStyle', { n: op.anchor.line.index + 1, style: op.style })
            : op.type === 'shot-component'
                ? t('shotComponent', { n: op.anchor.line.index + 1, slot: op.slot, value: op.value })
                : t('transition', { n: op.anchor.line.index + 1 }),
        detail: opReason(reason),
        remove: () => updateProject(project => ({ ...project, overrides: project.overrides.filter(item => item.id !== op.id) })),
    }));
    const directionProblems: Problem[] = program.invalidDirections.map((item, index) => ({
        key: `direction-${index}-${item.anchor.line.index}`,
        message: t('direction', { n: item.anchor.line.index + 1 }),
        detail: t('directionDetail'),
        remove: () => updateProject(project => ({
            ...project,
            paragraphDirections: project.paragraphDirections.filter(other => other !== item),
        })),
    }));
    const structureProblems: Problem[] = program.invalidStructureEdits.map(({ edit, reason }) => ({
        key: `structure-${edit.id}`,
        message: edit.type === 'kind'
            ? t('kind', { n: edit.anchor.index + 1 })
            : edit.type === 'break' ? t('split', { n: edit.anchor.index + 1 }) : t('merge', { n: edit.anchor.index + 1 }),
        detail: reason === 'line-missing' ? t('structureReasons.lineMissing') : reason === 'first-line' ? t('structureReasons.firstLine') : t('structureReasons.notStart'),
        remove: () => updateProject(project => ({ ...project, structureEdits: project.structureEdits.filter(item => item.id !== edit.id) })),
    }));
    const assetClips = useProjectStore(state => state.project.assetClips);
    const assets = useProjectStore(state => state.project.assets);
    const clipProblems: Problem[] = resolveAssetClips(assetClips, program, new Set(assets.map(item => item.id))).invalid.map(({ clip, reason }) => ({
        key: `clip-${clip.id}`,
        message: t('clip', { name: assets.find(item => item.id === clip.assetId)?.name ?? clip.assetId }),
        detail: reason === 'asset-missing' ? t('clipAssetMissing') : t('clipAnchorMissing'),
        remove: () => removeAssetClip(clip.id),
    }));
    const backgroundClips = useProjectStore(state => state.project.backgroundClips);
    const backgroundProblems: Problem[] = resolveBackgroundClips(backgroundClips, program, new Set(assets.map(item => item.id))).invalid.map(({ clip, reason }) => ({
        key: `background-${clip.id}`,
        message: t('background'),
        detail: reason === 'asset-missing' ? t('backgroundAssetMissing') : t('backgroundAnchorMissing'),
        remove: () => removeBackgroundClip(clip.id),
    }));
    const scriptProblems: Problem[] = useSession(state => state.scriptProblems).map((item, index) => ({
        key: `script-${index}-${item.line}`,
        message: t(item.code.startsWith('LS5') ? 'settingsDiagnostic' : 'scriptDiagnostic', { line: item.line, code: item.code, message: item.message }),
        detail: [item.hint, item.severity === 'error' ? t('notApplied') : t('hint')].filter(Boolean).join(t('detailSeparator')),
        remove: () => setSession({ scriptProblems: useSession.getState().scriptProblems.filter(other => other !== item) }),
        action: t('ignore'),
    }));
    return [...lyricProblems, ...opProblems, ...directionProblems, ...structureProblems, ...clipProblems, ...backgroundProblems, ...scriptProblems];
};

export const useLyricProblems = (): Problem[] => {
    const { invalidEdits, data } = useEffectiveLyrics();
    const { t } = useTranslation('problems');
    const reasonOf = (reason: InvalidEdit['reason']) => t(`lyricReasons.${reason}`);
    return invalidEdits.map((edit, index) => {
        const same = (item: { anchor: { index: number; hash: string } }) => item.anchor.index === edit.anchor.index && item.anchor.hash === edit.anchor.hash;
        const line = data?.lines[edit.anchor.index];
        const repairable = edit.kind === 'segments' && edit.reason === 'invalid-segmentation' && line;
        return {
            key: `lyric-${index}-${edit.kind}-${edit.anchor.index}`,
            message: edit.kind === 'line' ? t('lyricEdit', { n: edit.anchor.index + 1 }) : t('segmentation', { n: edit.anchor.index + 1 }),
            detail: repairable ? t('segmentationStale') : reasonOf(edit.reason),
            remove: () => updateProject(project => ({
                ...project,
                lyricEdits: {
                    ...project.lyricEdits,
                    lines: edit.kind === 'line' ? project.lyricEdits.lines.filter(item => !same(item)) : project.lyricEdits.lines,
                    segments: edit.kind === 'segments' ? project.lyricEdits.segments.filter(item => !same(item)) : project.lyricEdits.segments,
                },
            })),
            ...(repairable ? {
                action: t('useAutoSegmentation'),
                extra: [
                    { label: t('autoRepair'), run: () => repairLineSegmentation(edit.anchor, line) },
                    // 检查器的分词框里有修复后的样子，改好再应用。
                    { label: t('editManually'), run: () => setSession({ selection: { type: 'line', lineIndex: edit.anchor.index } }) },
                ],
            } : {}),
        };
    });
};

export function ProblemsList({ problems }: { problems: Problem[] }) {
    const { t } = useTranslation('problems');
    if (problems.length === 0) {
        return <div className="px-4 py-3 text-xs text-zinc-500">{t('none')}</div>;
    }
    return (
        <ul className="py-1 text-[13px]">
            {problems.map(problem => (
                <li key={problem.key} className="group flex items-center gap-2 px-3 py-1 hover:bg-zinc-900">
                    <AlertTriangle size={14} className="shrink-0 text-amber-400" />
                    <span className="text-zinc-200">{problem.message}</span>
                    <span className="text-zinc-500">{problem.detail}</span>
                    <div className="flex-1" />
                    {problem.extra?.map(item => (
                        <button
                            key={item.label}
                            type="button"
                            onClick={item.run}
                            className="rounded px-1.5 text-xs text-sky-300 hover:bg-zinc-800 hover:text-sky-100"
                        >
                            {item.label}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={problem.remove}
                        className="invisible rounded px-1.5 text-xs text-zinc-400 group-hover:visible hover:bg-zinc-800 hover:text-zinc-100"
                    >
                        {problem.action ?? t('remove')}
                    </button>
                </li>
            ))}
        </ul>
    );
}
