// src/app/wizard/Wizard.tsx
// 快速制作向导：五步——歌曲 → 风格 → 素材（可选）→ 配色 → 完成。桌面布局下停靠在检查器的位置（docked，由 Workbench 摆放，
// 中间的预览跟着让出位置、整个画面都露出来，每一步的选择立刻在预览里看到）；移动布局下铺满全屏。
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Wand2, X } from 'lucide-react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useProjectStore } from '@/project/store';
import { useIsMobileLayout } from '../mobile/uiMode';
import { indicatorSpring, sheetSpring } from '../motion';
import { Button, cx } from '../ui';
import { StepAssets } from './StepAssets';
import { StepDone } from './StepDone';
import { StepSong } from './StepSong';
import { StepStyle } from './StepStyle';
import { StepTheme } from './StepTheme';
import { closeWizard, setWizardStep, useWizard, WIZARD_STEPS } from './wizardStore';
import { useTranslation } from 'react-i18next';

/** 换步骤时内容顺着前进 / 后退的方向滑过去（custom = 方向，1 前进、-1 后退）。 */
const stepSlide: Variants = {
    enter: (direction: number) => ({ opacity: 0, x: direction * 24 }),
    center: { opacity: 1, x: 0 },
    exit: (direction: number) => ({ opacity: 0, x: direction * -24 }),
};

export function Wizard({ docked = false }: { docked?: boolean }) {
    const open = useWizard(state => state.open);
    const mobile = useIsMobileLayout();
    // 桌面布局由 Workbench 以 docked 摆放；这里的浮层只给移动布局用。
    return <AnimatePresence>{open && (docked || mobile) && <WizardBody docked={docked} />}</AnimatePresence>;
}

function WizardBody({ docked }: { docked: boolean }) {
    const step = useWizard(state => state.step);
    const hasSong = useProjectStore(state => Boolean(state.project.audio || state.project.lyrics));
    // 记下上一步，算出这次是前进还是后退（渲染期间派生，不必多一轮 effect）。
    const [shown, setShown] = useState(step);
    const [direction, setDirection] = useState(1);
    const { t } = useTranslation('wizard');
    if (shown !== step) {
        setDirection(step > shown ? 1 : -1);
        setShown(step);
    }

    // Esc 关闭（输入框里的 Esc 留给输入框）。
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (event.key === 'Escape' && !(target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) closeWizard();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const canNext = step > 0 || hasSong;
    const last = step === WIZARD_STEPS.length - 1;

    return (
        <motion.aside
            role="dialog"
            aria-label={t('title')}
            data-testid="wizard"
            // 停靠时从右侧滑入（Workbench 关掉时直接撤下、换回检查器）；移动端整屏从下方升起、退场再落下。
            initial={docked ? { opacity: 0, x: 32 } : { opacity: 0, y: 40 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={docked ? undefined : { opacity: 0, y: 40 }}
            transition={sheetSpring}
            className={cx(
                'flex flex-col border-zinc-800 bg-zinc-900',
                docked ? 'w-[440px] shrink-0 border-l' : 'fixed inset-0 z-40',
            )}
        >
            <header className="shrink-0 border-b border-zinc-800 px-5 pt-4 pb-3">
                <div className="flex items-center gap-2">
                    <Wand2 size={16} className="text-amber-400" />
                    <span className="text-sm font-medium text-zinc-100">{t('heading')}</span>
                    <button type="button" aria-label={t('close')} onClick={closeWizard} className="ml-auto rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
                        <X size={16} />
                    </button>
                </div>
                <ol className="mt-3 flex items-center gap-1.5" aria-label={t('steps.label')}>
                    {WIZARD_STEPS.map((id, index) => {
                        const done = index < step;
                        const current = index === step;
                        // 只能回到走过的步骤，或者在有歌之后往后跳。
                        const reachable = index <= step || hasSong;
                        return (
                            <li key={id} className="flex flex-1 items-center gap-1.5">
                                <button
                                    type="button"
                                    disabled={!reachable}
                                    aria-current={current ? 'step' : undefined}
                                    onClick={() => setWizardStep(index)}
                                    className="flex items-center gap-1.5 disabled:cursor-not-allowed"
                                >
                                    <motion.span
                                        animate={{ scale: current ? 1.12 : 1 }}
                                        transition={indicatorSpring}
                                        className={cx(
                                            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium transition-colors',
                                            current ? 'bg-amber-400 text-zinc-950' : done ? 'bg-amber-400/20 text-amber-300' : 'bg-zinc-800 text-zinc-500',
                                        )}
                                    >
                                        {done ? <Check size={11} /> : index + 1}
                                    </motion.span>
                                    <span className={cx('text-xs whitespace-nowrap', current ? 'text-zinc-100' : 'text-zinc-500')}>{t(`steps.${id}`)}</span>
                                </button>
                                {index < WIZARD_STEPS.length - 1 && (
                                    <span className="relative h-px flex-1 overflow-hidden bg-zinc-800">
                                        <motion.span
                                            className="absolute inset-0 origin-left bg-amber-400/40"
                                            initial={false}
                                            animate={{ scaleX: done ? 1 : 0 }}
                                            transition={{ duration: 0.3, ease: 'easeOut' }}
                                        />
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ol>
            </header>

            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-4">
                <AnimatePresence mode="wait" initial={false} custom={direction}>
                    <motion.div
                        key={step}
                        custom={direction}
                        variants={stepSlide}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
                    >
                        <h2 className="mb-4 text-lg font-semibold text-zinc-50">{t(`stepTitles.${WIZARD_STEPS[step]}`)}</h2>
                        {step === 0 && <StepSong />}
                        {step === 1 && <StepStyle />}
                        {step === 2 && <StepAssets />}
                        {step === 3 && <StepTheme />}
                        {step === 4 && <StepDone />}
                    </motion.div>
                </AnimatePresence>
            </div>

            {!last && (
                <footer className="flex shrink-0 items-center gap-2 border-t border-zinc-800 px-5 py-3">
                    {step > 0 && (
                        <Button variant="ghost" onClick={() => setWizardStep(step - 1)}>
                            <ArrowLeft size={14} /> {t('back')}
                        </Button>
                    )}
                    <span className="flex-1 text-[11px] text-zinc-500">{!canNext ? t('needSong') : t('previewHint')}</span>
                    <Button variant="primary" disabled={!canNext} onClick={() => setWizardStep(step + 1)}>
                        {t('next')} <ArrowRight size={14} />
                    </Button>
                </footer>
            )}
        </motion.aside>
    );
}
