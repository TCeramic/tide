// src/app/workbench/CommandPalette.tsx
// 命令面板（Ctrl+Shift+P / F1）。以 `>` 开头列命令，否则列工程（Ctrl+P，快速打开）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { listProjects, openProject } from '@/project/actions';
import type { ProjectRow } from '@/project/db';
import { formatKeybinding, useCommands, type Command } from './commands';
import { closeCommandPalette, setLayout, useLayout } from './layout';
import { dropDown, overlay, popTransition, presence } from '../motion';
import { useTranslation } from 'react-i18next';

interface Item {
    key: string;
    label: string;
    detail?: string;
    keybinding?: string;
    disabled?: boolean;
    run: () => void;
}

/** 子序列模糊匹配，得分越小越好；不匹配返回 null。 */
export const fuzzyScore = (text: string, query: string) => {
    if (!query) return 0;
    const haystack = text.toLowerCase();
    const needle = query.toLowerCase();
    const direct = haystack.indexOf(needle);
    if (direct >= 0) return direct;
    let position = 0;
    let gaps = 0;
    for (const char of needle) {
        const found = haystack.indexOf(char, position);
        if (found < 0) return null;
        gaps += found - position;
        position = found + 1;
    }
    return 100 + gaps;
};

export function CommandPalette() {
    const open = useLayout(state => state.commandPaletteOpen);
    return <AnimatePresence>{open && <CommandPaletteBody />}</AnimatePresence>;
}

function CommandPaletteBody() {
    const query = useLayout(state => state.commandPaletteQuery);
    const commands = useCommands(state => state.commands);
    const [projects, setProjects] = useState<ProjectRow[]>([]);
    const [active, setActive] = useState(0);
    const input = useRef<HTMLInputElement>(null);
    const commandMode = query.startsWith('>');
    const { t, i18n } = useTranslation('workbench');

    useEffect(() => {
        setActive(0);
        input.current?.focus();
        if (!commandMode) void listProjects().then(setProjects);
    }, [commandMode]);

    const items = useMemo<Item[]>(() => {
        const text = commandMode ? query.slice(1).trim() : query.trim();
        const source: Item[] = commandMode
            ? [...commands.values()].map((command: Command) => ({
                key: command.id,
                label: command.category ? `${command.category()}: ${command.title()}` : command.title(),
                keybinding: command.keybinding,
                disabled: command.enabled ? !command.enabled() : false,
                run: () => void command.run(),
            }))
            : projects.map(row => ({
                key: row.id,
                label: row.name,
                detail: new Date(row.updatedAt).toLocaleString(),
                run: () => void openProject(row.id),
            }));
        return source
            .map(item => ({ item, score: fuzzyScore(item.label, text) }))
            .filter((entry): entry is { item: Item; score: number } => entry.score !== null)
            .sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label))
            .map(entry => entry.item);
        // 语言变了标题也变：i18n.language 放进依赖。
    }, [commandMode, commands, projects, query, i18n.language]);

    const runItem = (item: Item | undefined) => {
        if (!item || item.disabled) return;
        closeCommandPalette();
        item.run();
    };

    return (
        <motion.div {...presence} variants={overlay} transition={popTransition} className="no-drag fixed inset-0 z-50" onMouseDown={closeCommandPalette}>
            <motion.div
                variants={dropDown}
                transition={popTransition}
                className="mx-auto mt-2 w-[min(600px,calc(100vw-32px))] origin-top overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
                onMouseDown={event => event.stopPropagation()}
            >
                <input
                    ref={input}
                    value={query}
                    placeholder={commandMode ? t('palette.commandPlaceholder') : t('palette.projectPlaceholder')}
                    onChange={event => {
                        setLayout({ commandPaletteQuery: event.target.value });
                        setActive(0);
                    }}
                    onKeyDown={event => {
                        if (event.key === 'Escape') closeCommandPalette();
                        else if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            setActive(index => Math.min(items.length - 1, index + 1));
                        } else if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            setActive(index => Math.max(0, index - 1));
                        } else if (event.key === 'Enter') {
                            event.preventDefault();
                            runItem(items[active]);
                        }
                    }}
                    className="h-9 w-full border-b border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none"
                />
                <ul className="max-h-80 overflow-y-auto py-1">
                    {items.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500">{t('palette.empty')}</li>}
                    {items.map((item, index) => (
                        <li
                            key={item.key}
                            onMouseEnter={() => setActive(index)}
                            onMouseDown={event => {
                                event.preventDefault();
                                runItem(item);
                            }}
                            className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm ${index === active ? 'bg-sky-900/50 text-zinc-50' : 'text-zinc-300'} ${item.disabled ? 'opacity-40' : ''}`}
                        >
                            <span className="truncate">{item.label}</span>
                            <span className="shrink-0 text-xs text-zinc-500">
                                {item.keybinding ? formatKeybinding(item.keybinding) : item.detail}
                            </span>
                        </li>
                    ))}
                </ul>
            </motion.div>
        </motion.div>
    );
}
