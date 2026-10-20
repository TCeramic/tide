// src/app/theme-park/ThemeParkColorPanel.tsx
// 「颜色」页：深 / 浅切换、四个颜色位、取色器与 HEX 输入、推荐色（封面取色 + 主题现有颜色）。
import { useEffect, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import type { DualTheme } from '@/core/types';
import { normalizeThemeHexColor } from '@/ai/vendor/themeSanitizer.mjs';
import { cx, inputClass, Segmented } from '../ui';
import { colorField, COLOR_KEYS, modeLabel, type EditableColorKey, type EditableMode } from './themeParkDraft';
import { useTranslation } from 'react-i18next';

/** react-colorful 拖动时 60fps 地回调：本地状态接住，只有取色器自己重绘；上层拿到的值由它自己节流。 */
function FastColorPicker({ color, onChange }: { color: string; onChange: (color: string) => void }) {
    const [local, setLocal] = useState(color);
    useEffect(() => setLocal(color), [color]);
    return (
        <HexColorPicker
            color={local}
            onChange={next => {
                setLocal(next);
                onChange(next);
            }}
            style={{ width: '100%', height: 200 }}
        />
    );
}

export function ThemeParkColorPanel({
    mode,
    colorKey,
    draft,
    safeDraft,
    recommended,
    onModeChange,
    onColorKeyChange,
    onColor,
    onHexInput,
}: {
    mode: EditableMode;
    colorKey: EditableColorKey;
    /** 原样的草稿（HEX 输入框显示用户正在输入的内容）。 */
    draft: DualTheme;
    /** 清洗过的草稿（色块与取色器用合法的颜色）。 */
    safeDraft: DualTheme;
    recommended: string[];
    onModeChange: (mode: EditableMode) => void;
    onColorKeyChange: (key: EditableColorKey) => void;
    onColor: (color: string) => void;
    onHexInput: (value: string) => void;
}) {
    const theme = safeDraft[mode];
    const { t } = useTranslation('theme');
    const active = colorField(colorKey);
    const activeColor = theme[colorKey];

    return (
        <div className="space-y-4">
            <Segmented<EditableMode>
                value={mode}
                onChange={onModeChange}
                options={(['dark', 'light'] as const).map(value => ({ value, label: modeLabel(value) }))}
            />

            <div className="space-y-1.5" role="radiogroup" aria-label={t('colorSlots')}>
                {COLOR_KEYS.map(key => {
                    const selected = key === colorKey;
                    const field = { key, ...colorField(key) };
                    return (
                        <button
                            key={field.key}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={field.label}
                            onClick={() => onColorKeyChange(field.key)}
                            className={cx(
                                'flex w-full items-center gap-3 rounded-md border px-2.5 py-2 text-left transition-colors',
                                selected ? 'border-amber-400/70 bg-zinc-800/80' : 'border-zinc-800 hover:border-zinc-600',
                            )}
                        >
                            <span className="h-8 w-8 shrink-0 rounded border border-white/10" style={{ backgroundColor: theme[field.key] }} />
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm text-zinc-100">{field.label}</span>
                                <span className="block truncate text-[11px] text-zinc-500">{field.description}</span>
                            </span>
                            <span className="font-mono text-xs text-zinc-400">{theme[field.key].toUpperCase()}</span>
                        </button>
                    );
                })}
            </div>

            <div className="space-y-3 rounded-md border border-zinc-800 p-3">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-100">{active.label}</span>
                    <span className="rounded-full px-2.5 py-0.5 font-mono text-xs" style={{ color: theme.backgroundColor, backgroundColor: activeColor }}>
                        {activeColor.toUpperCase()}
                    </span>
                </div>
                <FastColorPicker color={activeColor} onChange={onColor} />
                <label className="block space-y-1">
                    <span className="text-[11px] tracking-widest text-zinc-500 uppercase">HEX</span>
                    <input
                        aria-label="HEX"
                        value={draft[mode][colorKey]}
                        onChange={event => onHexInput(event.target.value)}
                        // 离开输入框时收成合法的颜色（输错了回到清洗后的值）。
                        onBlur={() => onHexInput(normalizeThemeHexColor(draft[mode][colorKey], activeColor))}
                        spellCheck={false}
                        className={cx(inputClass, 'font-mono select-text')}
                    />
                </label>
            </div>

            {recommended.length > 0 && (
                <div className="space-y-2">
                    <div className="text-[11px] tracking-widest text-zinc-500 uppercase">{t('recommended')}</div>
                    <div className="flex flex-wrap gap-1.5">
                        {recommended.map(color => (
                            <button
                                key={color}
                                type="button"
                                onClick={() => onColor(color)}
                                title={color.toUpperCase()}
                                aria-label={t('recommendedColor', { color })}
                                className="h-7 w-7 rounded border border-white/15 transition-transform hover:scale-110"
                                style={{ backgroundColor: color }}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
