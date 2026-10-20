// src/app/wizard/StepTheme.tsx
// 向导第 3 步：配色。默认 / 从封面取色 / 随机（骰子）/ AI 按歌词生成，外加深色、浅色。选中即写进工程，预览随之变化；
// 想细调颜色、关键字与图标，去主题编辑器。
import { useMemo, useState } from 'react';
import { Dices, ImageIcon, Palette, Sparkles, SwatchBook } from 'lucide-react';
import type { DualTheme } from '@/core/types';
import { generateAiTheme } from '@/ai/actions';
import { resolveAiProvider, useAiSettings } from '@/ai/settings';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '@/project/defaults';
import { useSession } from '@/project/session';
import { updateProject, useProjectStore } from '@/project/store';
import type { ProjectTheme } from '@/project/types';
import { useProgram } from '../DerivedProvider';
import { useIsMobileLayout } from '../mobile/uiMode';
import { log } from '../output';
import { Button, cx, Segmented } from '../ui';
import { executeCommand } from '../workbench/commands';
import { themeFromCover } from './coverTheme';
import { randomTheme } from './randomTheme';
import { stripModeSuffix } from './themeNames';
import { useTranslation } from 'react-i18next';
import { setWizardAiTheme, setWizardThemeSource, useWizard, type ThemeSource } from './wizardStore';

const DEFAULT_DUAL: DualTheme = { dark: DEFAULT_DARK_THEME, light: DEFAULT_LIGHT_THEME };

/** 当前工程主题是哪一种来源（打开向导时的初始高亮）。 */
const sourceOf = (theme: ProjectTheme): ThemeSource | null => {
    if (theme.source === 'preset') return 'default';
    if (theme.source === 'ai') return 'ai';
    if (theme.dual.dark.provider === 'Random') return 'random';
    return theme.dual.dark.provider === 'Cover' ? 'cover' : null;
};

function Swatches({ dual, variant }: { dual: DualTheme | null; variant: 'dark' | 'light' }) {
    const { t } = useTranslation('wizard');
    if (!dual) return <div className="h-12 w-full rounded-md border border-dashed border-zinc-700" />;
    const theme = dual[variant];
    return (
        <div className="flex h-12 w-full items-center gap-1.5 rounded-md px-2" style={{ backgroundColor: theme.backgroundColor }}>
            <span className="text-base font-semibold" style={{ color: theme.primaryColor }}>{t('theme.sample1')}</span>
            <span className="text-base font-semibold" style={{ color: theme.accentColor }}>{t('theme.sample2')}</span>
            <span className="ml-auto flex gap-1">
                {[theme.primaryColor, theme.accentColor, theme.secondaryColor].map((color, index) => (
                    <span key={index} className="h-3.5 w-3.5 rounded-full border border-white/15" style={{ backgroundColor: color }} />
                ))}
            </span>
        </div>
    );
}

export function StepTheme() {
    const theme = useProjectStore(state => state.project.theme);
    const program = useProgram();
    const coverColors = useSession(state => state.coverColors);
    const aiAvailable = useAiSettings(state => resolveAiProvider(state) !== null);
    const { themeSource, aiTheme } = useWizard();
    const mobile = useIsMobileLayout();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // 最近一次掷出的配色（工程里正用着随机配色时就是它）。
    const [rolled, setRolled] = useState<DualTheme | null>(() => (theme.dual.dark.provider === 'Random' ? theme.dual : null));
    const selected = themeSource ?? sourceOf(theme);
    const { t } = useTranslation(['wizard', 'theme', 'ai']);

    // 封面取色保留当前主题里的关键字颜色与歌词图标（它们来自歌词，不来自封面）。
    const coverTheme = useMemo(() => {
        const dual = themeFromCover(coverColors);
        if (!dual) return null;
        const shared = { wordColors: theme.dual.dark.wordColors, lyricsIcons: theme.dual.dark.lyricsIcons };
        return { dark: { ...dual.dark, ...shared }, light: { ...dual.light, ...shared } };
    }, [coverColors, theme.dual.dark.wordColors, theme.dual.dark.lyricsIcons]);

    const apply = (source: ThemeSource, dual: DualTheme, projectSource: ProjectTheme['source']) => {
        setWizardThemeSource(source);
        updateProject(p => ({ ...p, theme: { ...p.theme, source: projectSource, dual } }));
    };

    const generate = async () => {
        setBusy(true);
        setError(null);
        try {
            const dual = await generateAiTheme(program, useProjectStore.getState().project);
            setWizardAiTheme(dual);
            setWizardThemeSource('ai');
            log(t('ai:theme.done', { dark: dual.dark.name, light: dual.light.name }));
        } catch (reason) {
            setError((reason as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const cards: Array<{ id: ThemeSource; title: string; hint: string; icon: typeof Palette; dual: DualTheme | null; disabled: boolean; onPick: () => void }> = [
        { id: 'default', title: t('theme.default'), hint: t('theme.defaultHint'), icon: SwatchBook, dual: DEFAULT_DUAL, disabled: false, onPick: () => apply('default', DEFAULT_DUAL, 'preset') },
        {
            id: 'cover', title: t('theme.cover'), icon: ImageIcon, dual: coverTheme, disabled: !coverTheme,
            hint: coverTheme ? t('theme.coverHint') : t('theme.coverMissing'),
            onPick: () => coverTheme && apply('cover', coverTheme, 'custom'),
        },
        {
            id: 'random', title: t('theme.random'), icon: Dices, dual: rolled, disabled: false,
            hint: rolled ? t('theme.randomAgain', { name: stripModeSuffix(rolled.dark.name) }) : t('theme.randomHint'),
            onPick: () => {
                const dual = randomTheme(useProjectStore.getState().project.theme.dual);
                setRolled(dual);
                apply('random', dual, 'custom');
            },
        },
        {
            id: 'ai', title: t('theme.ai'), icon: Sparkles, dual: aiTheme, disabled: !aiAvailable || busy,
            hint: !aiAvailable ? t('theme.aiMissing') : busy ? t('ai:theme.busy') : aiTheme ? t('theme.aiBack', { name: aiTheme.dark.name }) : t('theme.aiHint'),
            onPick: () => (aiTheme ? apply('ai', aiTheme, 'ai') : void generate()),
        },
    ];

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-400">{t('theme.base')}</span>
                <Segmented<'dark' | 'light'>
                    value={theme.variant}
                    onChange={variant => updateProject(p => ({ ...p, theme: { ...p.theme, variant } }))}
                    options={[{ value: 'dark', label: t('theme:modes.dark') }, { value: 'light', label: t('theme:modes.light') }]}
                />
            </div>
            <div className="space-y-2">
                {cards.map(card => {
                    const Icon = card.icon;
                    const active = selected === card.id;
                    return (
                        <button
                            key={card.id}
                            type="button"
                            aria-pressed={active}
                            aria-label={t('theme.cardLabel', { title: card.title })}
                            disabled={card.disabled && !(card.id === 'ai' && aiTheme)}
                            onClick={card.onPick}
                            className={cx(
                                'flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                                active ? 'border-amber-400 bg-zinc-800/70' : 'border-zinc-800 bg-zinc-900/60 enabled:hover:border-zinc-600',
                            )}
                        >
                            <div className="w-36 shrink-0"><Swatches dual={card.dual} variant={theme.variant} /></div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 text-sm text-zinc-100"><Icon size={13} className="text-zinc-400" />{card.title}</div>
                                <div className="text-[11px] text-zinc-500">{card.hint}</div>
                            </div>
                        </button>
                    );
                })}
                {aiAvailable && aiTheme && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void generate()}>
                        <Sparkles size={13} /> {busy ? t('ai:theme.busy') : t('theme.aiAgain')}
                    </Button>
                )}
                {error && <div className="text-xs text-red-400">{error}</div>}
            </div>
            {!mobile && (
                <button type="button" onClick={() => executeCommand('view.themePark')} className="text-xs text-zinc-400 underline-offset-2 hover:text-amber-300 hover:underline">
                    {t('theme.openEditor')}
                </button>
            )}
        </div>
    );
}
