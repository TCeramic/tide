// src/app/workbench/QuickPick.tsx
// VS Code 的 Quick Pick：在命令面板的位置弹出一个可过滤的列表，返回用户选中的值（Esc 返回 undefined）。
// 高亮项变化时回调 onActive（用来在预览里试看），项可以带风格缩略图。
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { create } from 'zustand';
import { StyleThumb, useThumbnailLook } from '../library/StyleThumb';
import { fuzzyScore } from './CommandPalette';
import { dropDown, overlay, popTransition, presence } from '../motion';
import { useTranslation } from 'react-i18next';

export interface QuickPickItem<T> {
    label: string;
    description?: string;
    detail?: string;
    value: T;
    /** 显示这个风格的缩略图。 */
    thumbnail?: string;
    /** 当前值（打开时高亮它）。 */
    picked?: boolean;
}

interface QuickPickRequest {
    title?: string;
    placeholder?: string;
    items: QuickPickItem<unknown>[];
    onActive?: (value: unknown) => void;
    resolve: (value: unknown) => void;
}

const useQuickPick = create<{ request: QuickPickRequest | null }>(() => ({ request: null }));

export const showQuickPick = <T,>(
    items: QuickPickItem<T>[],
    options: { title?: string; placeholder?: string; onActive?: (value: T) => void } = {},
): Promise<T | undefined> => new Promise(resolve => {
    useQuickPick.getState().request?.resolve(undefined);
    useQuickPick.setState({
        request: {
            ...options,
            items: items as QuickPickItem<unknown>[],
            onActive: options.onActive as ((value: unknown) => void) | undefined,
            resolve: value => resolve(value as T | undefined),
        },
    });
});

export function QuickPick() {
    const request = useQuickPick(state => state.request);
    return (
        <AnimatePresence>
            {request && <QuickPickBody key={request.items.length + (request.title ?? '')} request={request} />}
        </AnimatePresence>
    );
}

function QuickPickBody({ request }: { request: QuickPickRequest }) {
    const [query, setQuery] = useState('');
    const initial = Math.max(0, request.items.findIndex(item => item.picked));
    const [active, setActive] = useState(initial);
    const input = useRef<HTMLInputElement>(null);
    const list = useRef<HTMLUListElement>(null);
    const look = useThumbnailLook();
    const { t } = useTranslation('workbench');
    const hasThumbnails = request.items.some(item => item.thumbnail);

    const items = useMemo(() => request.items
        .map((item, index) => ({ item, index, score: fuzzyScore(`${item.label} ${item.description ?? ''}`, query.trim()) }))
        .filter((entry): entry is { item: QuickPickItem<unknown>; index: number; score: number } => entry.score !== null)
        .sort((a, b) => (query.trim() ? a.score - b.score : a.index - b.index))
        .map(entry => entry.item), [request.items, query]);

    useEffect(() => { input.current?.focus(); }, []);
    useEffect(() => {
        const item = items[active];
        if (item) request.onActive?.(item.value);
        list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
    }, [active, items, request]);

    const close = (value: unknown) => {
        useQuickPick.setState({ request: null });
        request.resolve(value);
    };

    return (
        <motion.div {...presence} variants={overlay} transition={popTransition} className="no-drag fixed inset-0 z-50" onMouseDown={() => close(undefined)}>
            <motion.div
                role="dialog"
                aria-label={request.title ?? t('quickPick.title')}
                variants={dropDown}
                transition={popTransition}
                className="mx-auto mt-2 w-[min(600px,calc(100vw-32px))] origin-top overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
                onMouseDown={event => event.stopPropagation()}
            >
                {request.title && <div className="border-b border-zinc-800 px-3 py-1.5 text-xs text-zinc-400">{request.title}</div>}
                <input
                    ref={input}
                    value={query}
                    placeholder={request.placeholder ?? t('quickPick.placeholder')}
                    onChange={event => {
                        setQuery(event.target.value);
                        setActive(0);
                    }}
                    onKeyDown={event => {
                        if (event.key === 'Escape') close(undefined);
                        else if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            setActive(index => Math.min(items.length - 1, index + 1));
                        } else if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            setActive(index => Math.max(0, index - 1));
                        } else if (event.key === 'Enter') {
                            event.preventDefault();
                            if (items[active]) close(items[active].value);
                        }
                    }}
                    className="h-9 w-full border-b border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none select-text"
                />
                <ul ref={list} role="listbox" className="max-h-96 overflow-y-auto py-1">
                    {items.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500">{t('palette.empty')}</li>}
                    {items.map((item, index) => (
                        <li
                            key={`${item.label}-${index}`}
                            role="option"
                            aria-selected={index === active}
                            onMouseEnter={() => setActive(index)}
                            onMouseDown={event => {
                                event.preventDefault();
                                close(item.value);
                            }}
                            className={`flex cursor-pointer items-center gap-3 px-3 py-1 text-sm ${index === active ? 'bg-sky-900/50 text-zinc-50' : 'text-zinc-300'}`}
                        >
                            {hasThumbnails && (
                                item.thumbnail
                                    ? <StyleThumb style={item.thumbnail} look={look} active={index === active} className="h-9 w-16 shrink-0 overflow-hidden rounded-sm bg-zinc-950" />
                                    : <div className="h-9 w-16 shrink-0" />
                            )}
                            <span className="min-w-0 flex-1 truncate">
                                {item.label}
                                {item.picked && <span className="ml-2 text-xs text-amber-300">{t('quickPick.current')}</span>}
                            </span>
                            {(item.description || item.detail) && <span className="shrink-0 text-xs text-zinc-500">{item.description ?? item.detail}</span>}
                        </li>
                    ))}
                </ul>
            </motion.div>
        </motion.div>
    );
}
