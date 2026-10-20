// src/app/theme-park/ThemeParkContentPanel.tsx
// 「内容」页：关键字颜色（唱到这些词时字变成这个颜色）与歌词图标（lucide 图标名，绘光画成线稿、商籁拿来装饰）。
// 两者描述的是歌本身，深色、浅色两边共用。
import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { resolveLucideIcon } from '@/engine/shared/lucideIconResolver';
import { Button, cx, inputClass } from '../ui';
import { LYRICS_ICON_LIMIT, WORD_COLOR_LIMIT, type WordColorEntry } from './themeParkDraft';
import { useTranslation } from 'react-i18next';

export function ThemeParkContentPanel({
    wordColors,
    lyricsIcons,
    accentColor,
    onWordColorsChange,
    onLyricsIconsChange,
}: {
    wordColors: WordColorEntry[];
    lyricsIcons: string[];
    accentColor: string;
    onWordColorsChange: (next: WordColorEntry[]) => void;
    onLyricsIconsChange: (next: string[]) => void;
}) {
    const [iconDraft, setIconDraft] = useState('');
    const [iconError, setIconError] = useState<string | null>(null);
    const { t } = useTranslation(['theme', 'common']);

    const updateWord = (index: number, patch: Partial<WordColorEntry>) => onWordColorsChange(
        wordColors.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );

    const addIcon = () => {
        const name = iconDraft.trim();
        if (!name) return;
        if (!resolveLucideIcon(name)) {
            setIconError(t('content.unknownIcon'));
            return;
        }
        if (!lyricsIcons.includes(name)) onLyricsIconsChange([...lyricsIcons, name]);
        setIconDraft('');
        setIconError(null);
    };

    return (
        <div className="space-y-4">
            <div className="space-y-2.5 rounded-md border border-zinc-800 p-3">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <div className="text-sm text-zinc-100">{t('content.wordColors')}</div>
                        <div className="text-[11px] text-zinc-500">{t('content.wordColorsHint')}</div>
                    </div>
                    <Button
                        size="sm"
                        onClick={() => onWordColorsChange([...wordColors, { word: '', color: accentColor }])}
                        disabled={wordColors.length >= WORD_COLOR_LIMIT}
                    >
                        <Plus size={13} /> {t('content.add')}
                    </Button>
                </div>
                {wordColors.length === 0 ? (
                    <div className="rounded border border-dashed border-zinc-800 py-4 text-center text-xs text-zinc-500">{t('content.noWords')}</div>
                ) : (
                    <div className="space-y-1.5">
                        {wordColors.map((entry, index) => (
                            <div key={index} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/60 p-1.5">
                                <input
                                    type="color"
                                    aria-label={t('content.wordColor', { n: index + 1 })}
                                    value={entry.color}
                                    onChange={event => updateWord(index, { color: event.target.value })}
                                    className="h-7 w-8 shrink-0 cursor-pointer rounded border border-zinc-700 bg-transparent"
                                />
                                <input
                                    aria-label={t('content.word', { n: index + 1 })}
                                    value={entry.word}
                                    placeholder={t('content.wordPlaceholder')}
                                    onChange={event => updateWord(index, { word: event.target.value })}
                                    spellCheck={false}
                                    className="h-7 min-w-0 flex-1 bg-transparent px-1 text-sm text-zinc-100 outline-none select-text"
                                />
                                <span className="shrink-0 font-mono text-[11px] text-zinc-500">{entry.color.toUpperCase()}</span>
                                <button
                                    type="button"
                                    aria-label={t('content.deleteWord', { n: index + 1 })}
                                    onClick={() => onWordColorsChange(wordColors.filter((_, i) => i !== index))}
                                    className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="space-y-2.5 rounded-md border border-zinc-800 p-3">
                <div>
                    <div className="text-sm text-zinc-100">{t('content.icons')}</div>
                    <div className="text-[11px] text-zinc-500">{t('content.iconsHint', { count: LYRICS_ICON_LIMIT })}</div>
                </div>
                {lyricsIcons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {lyricsIcons.map(name => {
                            const Icon = resolveLucideIcon(name);
                            return (
                                <span key={name} className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 py-0.5 pr-1 pl-2 text-xs text-zinc-200">
                                    {Icon && <Icon size={12} />}
                                    {name}
                                    <button
                                        type="button"
                                        aria-label={t('content.deleteIcon', { name })}
                                        onClick={() => onLyricsIconsChange(lyricsIcons.filter(item => item !== name))}
                                        className="rounded-full p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100"
                                    >
                                        <X size={11} />
                                    </button>
                                </span>
                            );
                        })}
                    </div>
                )}
                <div className="flex gap-1.5">
                    <input
                        aria-label={t('content.iconName')}
                        value={iconDraft}
                        placeholder={t('content.iconPlaceholder')}
                        disabled={lyricsIcons.length >= LYRICS_ICON_LIMIT}
                        onChange={event => {
                            setIconDraft(event.target.value);
                            setIconError(null);
                        }}
                        onKeyDown={event => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                addIcon();
                            }
                        }}
                        spellCheck={false}
                        className={cx(inputClass, 'select-text')}
                    />
                    <Button onClick={addIcon} disabled={lyricsIcons.length >= LYRICS_ICON_LIMIT}>
                        <Plus size={13} /> {t('content.add')}
                    </Button>
                </div>
                {iconError && <div className="text-xs text-red-400">{iconError}</div>}
            </div>
        </div>
    );
}
