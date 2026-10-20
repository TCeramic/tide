// src/app/wizard/EmptyStageCard.tsx
// 空工程（没有音频也没有歌词）时盖在预览中间的引导卡片：打开向导，或者直接把文件拖进来。
// 只有卡片本身接收鼠标，周围照常可以拖放。
import { Wand2, X } from 'lucide-react';
import { useProjectStore } from '@/project/store';
import { Button } from '../ui';
import { dismissEmptyStageCard, openWizard, useWizard } from './wizardStore';
import { useTranslation } from 'react-i18next';

export function EmptyStageCard() {
    const empty = useProjectStore(state => !state.project.audio && !state.project.lyrics);
    const projectId = useProjectStore(state => state.project.id);
    const wizardOpen = useWizard(state => state.open);
    const dismissed = useWizard(state => state.dismissed.includes(projectId));
    const { t } = useTranslation('wizard');
    if (!empty || wizardOpen || dismissed) return null;
    return (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
            <div data-testid="empty-stage" className="pointer-events-auto relative flex max-w-sm flex-col items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/90 px-8 py-7 text-center shadow-2xl backdrop-blur">
                <button
                    type="button"
                    aria-label={t('empty.close')}
                    title={t('empty.closeHint')}
                    onClick={() => dismissEmptyStageCard(projectId)}
                    className="absolute top-2 right-2 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                >
                    <X size={14} />
                </button>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-400/15 text-amber-400">
                    <Wand2 size={20} />
                </div>
                <div className="text-base font-semibold text-zinc-50">{t('empty.title')}</div>
                <div className="text-sm leading-relaxed text-zinc-400">{t('empty.body')}</div>
                <Button variant="primary" onClick={() => void openWizard({ fresh: false })}>
                    <Wand2 size={14} /> {t('empty.start')}
                </Button>
                <div className="text-[11px] text-zinc-500">{t('empty.drop')}</div>
            </div>
        </div>
    );
}
