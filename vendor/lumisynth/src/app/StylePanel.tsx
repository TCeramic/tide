// src/app/StylePanel.tsx
// 主侧栏「画面与编排」：画幅、主题、背景、后处理、运动、两个包的观感开关、tempera 图片池、
// 编排参数（EngineParams）、seed。编排的模式与段落级设置在检查器里。
import { BackgroundTrackList } from './BackgroundTrackList';
import { randomTheme } from './wizard/randomTheme';
import { TypographySettings } from './TypographySettings';
import { ChevronDown, ChevronRight, Dices, Palette } from 'lucide-react';
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { PackId } from '@/compiler/types';
import { DEFAULT_ENGINE_PARAMS, packParams, type EngineParams } from '@/compiler/params';
import { findPack, getPack, listPacks } from '@/packs/registry';
import type { Theme } from '@/core/types';
import type { KernelTuning } from '@/kernel/tuning';
import { activeTheme, newId, packTuningOf } from '@/project/defaults';
import { updateProject, useProjectStore } from '@/project/store';
import type { OutputAspect } from '@/project/types';
import { Button, Field, inputClass, Segmented, Slider, Toggle, cx } from './ui';
import { useIsMobileLayout } from './mobile/uiMode';
import { executeCommand } from './workbench/commands';
import { useTranslation } from 'react-i18next';
import { packLabel } from '@/i18n/catalog';

export const packColor = (id: PackId) => findPack(id)?.color ?? '#71717a';

/**
 * 「设置」编辑器用的搜索：分组全部展开，只显示文字里含搜索词的分组（标题、标签、说明都算）。
 * 侧栏里没有这个上下文，分组照常折叠。
 */
export const SettingsSearchContext = createContext<{ query: string } | null>(null);

/** 可折叠的分组，展开状态只在本次会话内记住。 */
function Group({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
    const search = useContext(SettingsSearchContext);
    const [open, setOpen] = useState(defaultOpen || search !== null);
    const ref = useRef<HTMLElement>(null);
    const [matches, setMatches] = useState(true);
    const query = search?.query.trim().toLowerCase() ?? '';
    useLayoutEffect(() => {
        if (!query) {
            setMatches(true);
            return;
        }
        setMatches((ref.current?.textContent ?? '').toLowerCase().includes(query) || title.toLowerCase().includes(query));
    }, [query, title, children]);
    return (
        <section ref={ref} className={cx('border-b border-zinc-800', !matches && 'hidden')}>
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                className="flex w-full items-center gap-1 px-3 py-2 text-[11px] font-semibold tracking-widest text-zinc-400 uppercase hover:text-zinc-200"
            >
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {title}
            </button>
            {/* 搜索时内容始终渲染（隐藏），这样没展开的分组也能按内容匹配。 */}
            {(open || query) && <div className={cx('space-y-2.5 px-4 pb-3', !open && 'hidden')}>{children}</div>}
        </section>
    );
}

const patchPackTuning = (pack: PackId, patch: object, key: string) => updateProject(
    p => ({ ...p, tuning: { ...p.tuning, packs: { ...p.tuning.packs, [pack]: { ...packTuningOf<object>(p, pack), ...patch } } } }),
    { coalesce: `pack.${pack}.${key}` },
);
const patchPackParams = (pack: PackId, patch: object, key: string) => updateProject(
    p => ({
        ...p,
        engineParams: {
            ...p.engineParams,
            packs: { ...p.engineParams.packs, [pack]: { ...(packParams(p.engineParams, getPack(pack)) as object), ...patch } },
        },
    }),
    { coalesce: `params.${pack}.${key}` },
);
const patchKernel = <K extends keyof KernelTuning>(key: K, patch: Partial<KernelTuning[K]> | KernelTuning[K]) => updateProject(
    p => ({
        ...p,
        tuning: {
            ...p.tuning,
            kernel: {
                ...p.tuning.kernel,
                [key]: typeof patch === 'object' && patch !== null ? { ...(p.tuning.kernel[key] as object), ...patch } : patch,
            },
        },
    }),
    { coalesce: `kernel.${String(key)}.${typeof patch === 'object' && patch ? Object.keys(patch).join(',') : ''}` },
);
const patchStructure = (patch: Partial<EngineParams['paragraph']>) => updateProject(
    p => ({ ...p, engineParams: { ...p.engineParams, paragraph: { ...p.engineParams.paragraph, ...patch } } }),
    { coalesce: `params.paragraph.${Object.keys(patch).join(',')}` },
);

const THEME_COLORS = ['backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor'] as const;

function ThemeEditor() {
    const theme = useProjectStore(state => state.project.theme);
    const mobile = useIsMobileLayout();
    const { t } = useTranslation('look');
    const current = theme.dual[theme.variant];
    const patchTheme = (patch: Partial<Theme>, key: string) => updateProject(p => ({
        ...p,
        theme: { ...p.theme, source: 'custom', dual: { ...p.theme.dual, [p.theme.variant]: { ...p.theme.dual[p.theme.variant], ...patch } } },
    }), { coalesce: `theme.${key}` });
    return (
        <>
            <div className="flex gap-1.5">
                <div className="flex-1">
                    <Segmented<'dark' | 'light'>
                        value={theme.variant}
                        onChange={variant => updateProject(p => ({ ...p, theme: { ...p.theme, variant } }))}
                        options={[{ value: 'dark', label: t('theme.dark') }, { value: 'light', label: t('theme.light') }]}
                    />
                </div>
                <Button
                    onClick={() => updateProject(p => ({ ...p, theme: { ...p.theme, source: 'custom', dual: randomTheme(p.theme.dual) } }))}
                    aria-label={t('theme.random')}
                    title={t('theme.randomHint')}
                >
                    <Dices size={15} />
                </Button>
            </div>
            <div className="text-[11px] text-zinc-500">{current.name}{theme.source === 'ai' ? t('theme.sourceAi') : theme.source === 'custom' ? t('theme.sourceCustom') : ''}</div>
            <div className="grid grid-cols-4 gap-2">
                {THEME_COLORS.map(key => (
                    <label key={key} className="flex flex-col items-center gap-1 text-[11px] text-zinc-400">
                        <input
                            type="color"
                            value={String(current[key])}
                            onChange={event => patchTheme({ [key]: event.target.value }, key)}
                            className="h-7 w-full cursor-pointer rounded border border-zinc-700 bg-transparent"
                        />
                        {t(`theme.colors.${key}`)}
                    </label>
                ))}
            </div>
            <Field label={t('theme.intensity')}>
                <Segmented<Theme['animationIntensity']>
                    value={current.animationIntensity}
                    onChange={animationIntensity => patchTheme({ animationIntensity }, 'animationIntensity')}
                    options={[{ value: 'calm', label: t('theme.calm') }, { value: 'normal', label: t('theme.normal') }, { value: 'chaotic', label: t('theme.chaotic') }]}
                />
            </Field>
            {!mobile && (
                <Button className="w-full" onClick={() => executeCommand('view.themePark')} title={t('theme.openEditorHint')}>
                    <Palette size={14} /> {t('theme.openEditor')}
                </Button>
            )}
        </>
    );
}

export function StylePanel() {
    const project = useProjectStore(state => state.project);
    const { aspect, seed, tuning, engineParams } = project;
    const kernel = tuning.kernel;
    const theme = activeTheme(project);
    const { t } = useTranslation('look');

    return (
        <>
            <Group title={t('groups.frame')} defaultOpen>
                <Field label={t('frame.aspect')}>
                    <Segmented<OutputAspect>
                        value={aspect}
                        onChange={value => updateProject(p => ({ ...p, aspect: value }))}
                        options={[
                            { value: '16:9', label: '16:9' },
                            { value: '9:16', label: '9:16' },
                            { value: '1:1', label: '1:1' },
                            { value: '4:3', label: '4:3' },
                        ]}
                    />
                </Field>
                <Field label="seed" hint={t('frame.seedHint')}>
                    <div className="flex gap-1.5">
                        <input
                            value={seed}
                            onChange={event => updateProject(p => ({ ...p, seed: event.target.value }), { coalesce: 'seed' })}
                            className={inputClass}
                        />
                        <Button onClick={() => updateProject(p => ({ ...p, seed: newId().slice(0, 8) }))} aria-label={t('frame.reseed')}>
                            <Dices size={15} />
                        </Button>
                    </div>
                </Field>
            </Group>

            <Group title={t('groups.theme')} defaultOpen>
                <ThemeEditor />
            </Group>

            <Group title={t('groups.fonts')}>
                <TypographySettings />
            </Group>
            <Group title={t('groups.background')}>
                <Field label={t('background.default')}>
                    <Segmented<KernelTuning['background']['mode']>
                        value={kernel.background.mode}
                        onChange={mode => patchKernel('background', { mode })}
                        options={[{ value: 'theme', label: t('background.theme', { color: theme.backgroundColor }) }, { value: 'cover', label: t('background.cover') }]}
                    />
                </Field>
                {kernel.background.mode === 'cover' && (
                    <>
                        <Field label={t('background.coverBlur')}><Slider value={kernel.background.coverBlur} min={0} max={60} step={1} onChange={v => patchKernel('background', { coverBlur: v })} /></Field>
                        <Field label={t('background.coverDim')}><Slider value={kernel.background.coverDim} min={0} max={1} step={0.01} onChange={v => patchKernel('background', { coverDim: v })} format={v => v.toFixed(2)} /></Field>
                    </>
                )}
                <BackgroundTrackList />
                <Toggle label={t('background.postProcess')} checked={kernel.postProcess.enabled} onChange={enabled => patchKernel('postProcess', { enabled })} />
                {kernel.postProcess.enabled && ([
                    ['grain', 1], ['contrast', 1], ['rgbShift', 1], ['halftone', 1],
                    ['vignette', 2], ['lensDistortion', 2], ['lensDispersion', 1],
                ] as const).map(([key, max]) => (
                    <Field key={key} label={t(`postProcess.${key}`)}>
                        <Slider value={kernel.postProcess[key] as number} min={0} max={max} step={0.01} onChange={v => patchKernel('postProcess', { [key]: v })} format={v => v.toFixed(2)} />
                    </Field>
                ))}
            </Group>

            <Group title={t('groups.motion')}>
                <Toggle label={t('motion.transitions')} checked={kernel.enableTransitions} onChange={enableTransitions => patchKernel('enableTransitions', enableTransitions)} />
                <Field label={t('motion.camera')}><Slider value={kernel.motion.camera} min={0} max={2} step={0.01} onChange={v => patchKernel('motion', { camera: v })} format={v => `×${v.toFixed(2)}`} /></Field>
                <Field label={t('motion.typography')}><Slider value={kernel.motion.typography} min={0} max={2} step={0.01} onChange={v => patchKernel('motion', { typography: v })} format={v => `×${v.toFixed(2)}`} /></Field>
            </Group>

            {listPacks().map(pack => (
                <Group key={pack.id} title={packLabel(pack.id)}>
                    {pack.SettingsPanel
                        ? (
                            <pack.SettingsPanel
                                tuning={packTuningOf(project, pack.id)}
                                params={packParams(engineParams, pack)}
                                patchTuning={(patch, key) => patchPackTuning(pack.id, patch, key)}
                                patchParams={(patch, key) => patchPackParams(pack.id, patch, key)}
                            />
                        )
                        : <div className="text-xs text-zinc-500">{t('packNoSettings')}</div>}
                </Group>
            ))}

            <Group title={t('groups.structure')}>
                <Field label={t('structure.maxLines')}><Slider value={engineParams.paragraph.maxLines} min={2} max={12} step={1} onChange={v => patchStructure({ maxLines: v })} /></Field>
                <Field label={t('structure.maxDuration')}><Slider value={engineParams.paragraph.maxDuration} min={6} max={40} step={1} onChange={v => patchStructure({ maxDuration: v })} /></Field>
                <Field label={t('structure.gapMultiplier')} hint={t('structure.gapMultiplierHint')}><Slider value={engineParams.paragraph.gapMultiplier} min={1} max={5} step={0.1} onChange={v => patchStructure({ gapMultiplier: v })} format={v => v.toFixed(1)} /></Field>
                <Toggle label={t('structure.recursiveSplit')} checked={engineParams.paragraph.recursiveSplit} onChange={v => patchStructure({ recursiveSplit: v })} />
                <div className="text-[11px] text-zinc-500">{t('structure.shotParamsHint')}</div>
                <Button size="sm" variant="ghost" onClick={() => updateProject(p => ({ ...p, engineParams: DEFAULT_ENGINE_PARAMS }))}>{t('structure.resetAll')}</Button>
            </Group>
        </>
    );
}
