// src/app/workbench/ContextMenu.tsx
// 右键菜单（VS Code 风格）：点外面、Esc、滚动、窗口失焦都会关掉；方向键 + 回车可操作。
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { create } from 'zustand';
import { formatKeybinding } from './commands';
import { overlay, popIn, popTransition, presence } from '../motion';

export type ContextMenuItem =
    | { label: string; run: () => unknown; disabled?: boolean; keybinding?: string; checked?: boolean }
    | 'separator';

interface MenuRequest { x: number; y: number; items: ContextMenuItem[] }

const useContextMenu = create<{ menu: MenuRequest | null }>(() => ({ menu: null }));

export const showContextMenu = (event: ReactMouseEvent | MouseEvent, items: ContextMenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    useContextMenu.setState({ menu: { x: event.clientX, y: event.clientY, items } });
};

const closeMenu = () => useContextMenu.setState({ menu: null });

export function ContextMenu() {
    const menu = useContextMenu(state => state.menu);
    // 每次弹出换 key：在菜单开着时再右键，旧的退场、新的在新位置弹出。
    return <AnimatePresence>{menu && <ContextMenuBody key={`${menu.x},${menu.y}`} menu={menu} />}</AnimatePresence>;
}

function ContextMenuBody({ menu }: { menu: MenuRequest }) {
    const ref = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [active, setActive] = useState(-1);

    useLayoutEffect(() => {
        if (!ref.current) return;
        // offsetWidth 不受入场缩放的影响。
        const { offsetWidth: width, offsetHeight: height } = ref.current;
        setPosition({
            x: Math.min(menu.x, window.innerWidth - width - 4),
            y: Math.min(menu.y, window.innerHeight - height - 4),
        });
        setActive(-1);
        ref.current.focus();
    }, [menu]);

    useEffect(() => {
        const close = () => closeMenu();
        window.addEventListener('blur', close);
        window.addEventListener('resize', close);
        window.addEventListener('wheel', close, { passive: true });
        return () => {
            window.removeEventListener('blur', close);
            window.removeEventListener('resize', close);
            window.removeEventListener('wheel', close);
        };
    }, [menu]);

    const actionable = menu.items
        .map((item, index) => ({ item, index }))
        .filter(entry => entry.item !== 'separator' && !entry.item.disabled)
        .map(entry => entry.index);

    const run = (item: ContextMenuItem) => {
        if (item === 'separator' || item.disabled) return;
        closeMenu();
        void item.run();
    };

    return (
        <motion.div
            {...presence}
            variants={overlay}
            transition={popTransition}
            className="no-drag fixed inset-0 z-[60]"
            onMouseDown={closeMenu}
            onContextMenu={event => { event.preventDefault(); closeMenu(); }}
        >
            <motion.div
                ref={ref}
                role="menu"
                tabIndex={-1}
                variants={popIn}
                transition={popTransition}
                style={{ left: position.x, top: position.y, transformOrigin: `${menu.x - position.x}px ${menu.y - position.y}px` }}
                onMouseDown={event => event.stopPropagation()}
                onKeyDown={event => {
                    const at = actionable.indexOf(active);
                    if (event.key === 'Escape') closeMenu();
                    else if (event.key === 'ArrowDown') setActive(actionable[(at + 1) % actionable.length]);
                    else if (event.key === 'ArrowUp') setActive(actionable[(at - 1 + actionable.length) % actionable.length]);
                    else if (event.key === 'Enter' && active >= 0) run(menu.items[active]);
                    else return;
                    event.preventDefault();
                }}
                className="fixed min-w-48 rounded-md border border-zinc-700 bg-zinc-900 py-1 text-[13px] shadow-2xl outline-none"
            >
                {menu.items.map((item, index) => (item === 'separator'
                    ? <div key={`s${index}`} className="my-1 border-t border-zinc-800" />
                    : (
                        <button
                            key={`${item.label}-${index}`}
                            type="button"
                            role="menuitem"
                            disabled={item.disabled}
                            onMouseEnter={() => setActive(index)}
                            onClick={() => run(item)}
                            className={`flex w-full items-center gap-4 px-3 py-1 text-left disabled:opacity-40 ${index === active ? 'bg-sky-900/60 text-zinc-50' : 'text-zinc-200'}`}
                        >
                            <span className="w-3 shrink-0 text-amber-300">{item.checked ? '✓' : ''}</span>
                            <span className="flex-1">{item.label}</span>
                            {item.keybinding && <span className="text-xs text-zinc-500">{formatKeybinding(item.keybinding)}</span>}
                        </button>
                    )))}
            </motion.div>
        </motion.div>
    );
}
