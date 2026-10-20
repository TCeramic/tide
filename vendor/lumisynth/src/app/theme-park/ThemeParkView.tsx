// src/app/theme-park/ThemeParkView.tsx
// 编辑区「主题」标签页：移植自 folia 的 Theme Park。左边（分栏）是实时预览——预览画的是草稿，
// 右边是分页的编辑器：颜色 / 详情 / 内容 / AI。点「应用」才写进工程（一步撤销）。
import { useEffect, useMemo } from 'react';
import { Check, Dices, Palette, RotateCcw, Undo2 } from 'lucide-react';
import { useProjectStore } from '@/project/store';
import { useSession } from '@/project/session';
import { log } from '../output';
import { Button, cx } from '../ui';
import { ThemeParkAiPanel } from './ThemeParkAiPanel';
import { ThemeParkColorPanel } from './ThemeParkColorPanel';
import { ThemeParkContentPanel } from './ThemeParkContentPanel';
import { ThemeParkDetailsPanel } from './ThemeParkDetailsPanel';
import { randomTheme } from '../wizard/randomTheme';
import { buildRecommendedColors, isDualThemeNameValid, modeLabel, type ThemeParkTab } from './themeParkDraft';
import { useTranslation } from 'react-i18next';
import {
    applyThemeDraft,
    isThemeDraftDirty,
    openThemeDraft,
    patchThemeMode,
    patchThemeShared,
    replaceThemeDraft,
    resetThemeDraftColors,
    resolvedThemeDraft,
    revertThemeDraft,
    setThemeColor,
    setThemeParkColorKey,
    setThemeParkMode,
    setThemeParkTab,
    useThemePark,
} from './themeParkStore';

const TABS: ThemeParkTab[] = ['colors', 'details', 'content', 'ai'];

export function ThemeParkView() {
    useEffect(() => openThemeDraft(), []);
    const { t } = useTranslation('theme');
    const { draft, base, mode, colorKey, tab } = useThemePark();
    const project = useProjectStore(state => state.project.theme);
    const coverColors = useSession(state => state.coverColors);

    const safeDraft = useMemo(() => (draft ? resolvedThemeDraft(draft) : null), [draft]);
    const recommended = useMemo(() => (base ? buildRecommendedColors(base, coverColors) : []), [base, coverColors]);
    if (!draft || !safeDraft) return null;

    const dirty = isThemeDraftDirty({ draft, base });
    const nameValid = isDualThemeNameValid(draft);
    const apply = () => {
        if (applyThemeDraft()) log(t('view.applied', { dark: safeDraft.dark.name, light: safeDraft.light.name }));
    };

    return (
        <div data-testid="theme-park" className="flex min-h-0 flex-1 flex-col">
            <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
                <Palette size={16} className="text-amber-400" />
                <div className="min-w-0 flex-1">
                    <div className="text-sm text-zinc-100">{t('view.title')}</div>
                    <div className="truncate text-[11px] text-zinc-500">
                        {dirty
                            ? t('view.dirty', { mode: modeLabel(mode) })
                            : t('view.current', { name: project.dual[project.variant].name, source: t(`view.sources.${project.source}`), mode: modeLabel(project.variant) })}
                    </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => replaceThemeDraft(randomTheme(safeDraft))} title={t('view.randomHint')}>
                    <Dices size={13} /> {t('view.random')}
                </Button>
                <Button size="sm" variant="ghost" onClick={resetThemeDraftColors} title={t('view.defaultsHint')}>
                    <RotateCcw size={13} /> {t('view.defaults')}
                </Button>
                <Button size="sm" variant="ghost" onClick={revertThemeDraft} disabled={!dirty}>
                    <Undo2 size={13} /> {t('view.discard')}
                </Button>
                <Button size="sm" variant="primary" onClick={apply} disabled={!dirty || !nameValid} title={nameValid ? t('view.applyHint') : t('view.nameRequired')}>
                    <Check size={13} /> {t('view.apply')}
                </Button>
            </header>

            <div role="tablist" aria-label={t('view.title')} className="flex shrink-0 gap-1 border-b border-zinc-800 px-3">
                {TABS.map(item => (
                    <button
                        key={item}
                        type="button"
                        role="tab"
                        aria-selected={tab === item}
                        onClick={() => setThemeParkTab(item)}
                        className={cx('border-b-2 px-3 py-2 text-xs', tab === item ? 'border-amber-400 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300')}
                    >
                        {t(`view.tabs.${item}`)}
                    </button>
                ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-md px-4 py-4">
                    {tab === 'colors' && (
                        <ThemeParkColorPanel
                            mode={mode}
                            colorKey={colorKey}
                            draft={draft}
                            safeDraft={safeDraft}
                            recommended={recommended}
                            onModeChange={setThemeParkMode}
                            onColorKeyChange={setThemeParkColorKey}
                            onColor={setThemeColor}
                            onHexInput={value => patchThemeMode({ [colorKey]: value })}
                        />
                    )}
                    {tab === 'details' && <ThemeParkDetailsPanel draft={draft} onChange={(target, patch) => patchThemeMode(patch, target)} />}
                    {tab === 'content' && (
                        <ThemeParkContentPanel
                            wordColors={draft.dark.wordColors ?? []}
                            lyricsIcons={draft.dark.lyricsIcons ?? []}
                            accentColor={safeDraft[mode].accentColor}
                            onWordColorsChange={wordColors => patchThemeShared({ wordColors })}
                            onLyricsIconsChange={lyricsIcons => patchThemeShared({ lyricsIcons })}
                        />
                    )}
                    {tab === 'ai' && <ThemeParkAiPanel buildTheme={() => resolvedThemeDraft(draft)} onImport={replaceThemeDraft} />}
                </div>
            </div>
        </div>
    );
}
