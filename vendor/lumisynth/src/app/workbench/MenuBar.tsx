// src/app/workbench/MenuBar.tsx
// 标题栏：菜单（全部指向命令 id）+ 居中的命令中心 + 右侧的布局开关（主侧栏 / 面板 / 辅助栏）。
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Download, PanelBottom, PanelLeft, PanelRight, Search, Wand2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useProjectStore } from '@/project/store';
import { executeCommand, formatKeybinding, useCommands } from './commands';
import { openCommandPalette, useLayout, type LayoutState } from './layout';
import { expandMenuItems } from '../appCommands';
import { LumiMark } from '../LumiMark';
import { dropDown, popTransition } from '../motion';
import { useTranslation } from 'react-i18next';
import { t as translate } from '@/i18n';

export interface MenuDefinition {
    /** 显示时才取文字（跟着界面语言变）。 */
    label: () => string;
    /** 命令 id；'-' 为分隔线，'#键' 为分组的小标题（commands:groups 里的键）。 */
    items: string[];
}

const LAYOUT_TOGGLES: Array<{ command: string; key: keyof LayoutState; icon: LucideIcon; label: 'sideBar' | 'panel' | 'auxBar' }> = [
    { command: 'workbench.toggleSideBar', key: 'sideBarVisible', icon: PanelLeft, label: 'sideBar' },
    { command: 'workbench.togglePanel', key: 'panelVisible', icon: PanelBottom, label: 'panel' },
    { command: 'workbench.toggleAuxBar', key: 'auxBarVisible', icon: PanelRight, label: 'auxBar' },
];

/** 菜单里分组小标题的文字。 */
const groupLabel = (key: string) => translate(`commands:groups.${key}` as never) as string;

/** VS Code 标题栏右侧的三个布局开关：亮 = 显示中。 */
function LayoutToggles() {
    const layout = useLayout();
    const commands = useCommands(state => state.commands);
    const { t } = useTranslation('workbench');
    return (
        <div className="mr-2 flex items-center gap-0.5">
            {LAYOUT_TOGGLES.map(({ command, key, icon: Icon, label }) => {
                const visible = Boolean(layout[key]);
                const binding = commands.get(command)?.keybinding;
                const name = t(`layoutToggles.${label}`);
                const title = `${visible ? t('layoutToggles.hide', { name }) : t('layoutToggles.show', { name })}${binding ? ` (${formatKeybinding(binding)})` : ''}`;
                return (
                    <button
                        key={command}
                        type="button"
                        title={title}
                        aria-label={t('layoutToggles.toggle', { name })}
                        aria-pressed={visible}
                        onClick={() => executeCommand(command)}
                        className={`flex h-6 w-7 items-center justify-center rounded ${visible ? 'text-zinc-200' : 'text-zinc-600'} hover:bg-zinc-800 hover:text-zinc-50`}
                    >
                        <Icon size={15} strokeWidth={1.7} />
                    </button>
                );
            })}
        </div>
    );
}

export function MenuBar({ menus }: { menus: MenuDefinition[] }) {
    const [open, setOpen] = useState<number | null>(null);
    // 菜单开着时鼠标滑到别的菜单：直接换过去，不再播入场。
    const [switching, setSwitching] = useState(false);
    const commands = useCommands(state => state.commands);
    const name = useProjectStore(state => state.project.name);
    const { t } = useTranslation('workbench');

    return (
        <header className="titlebar relative flex h-9 shrink-0 items-center border-b border-zinc-800 bg-zinc-900 text-[13px] select-none">
            <span className="mr-3 flex items-center gap-2 pl-1 text-sm font-semibold tracking-wide text-zinc-100">
                <LumiMark className="h-[18px] w-[18px]" />
                <span>lumi<span className="text-amber-400">synth</span></span>
            </span>
            {menus.map((menu, index) => (
                <div key={menu.items.join()} className="relative">
                    <button
                        type="button"
                        onClick={() => {
                            setSwitching(false);
                            setOpen(open === index ? null : index);
                        }}
                        onMouseEnter={() => {
                            if (open === null || open === index) return;
                            setSwitching(true);
                            setOpen(index);
                        }}
                        className={`rounded px-2 py-1 ${open === index ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-300 hover:bg-zinc-800'}`}
                    >
                        {menu.label()}
                    </button>
                    {open === index && (
                        <motion.div
                            initial={switching ? false : 'hidden'}
                            animate="visible"
                            variants={dropDown}
                            transition={popTransition}
                            className="no-drag absolute top-full left-0 z-40 mt-0.5 w-max min-w-60 origin-top-left rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
                        >
                            {expandMenuItems(menu.items).map((id, itemIndex) => {
                                if (id === '-') return <div key={`sep-${itemIndex}`} className="my-1 h-px bg-zinc-800" />;
                                if (id.startsWith('#')) {
                                    return <div key={`head-${itemIndex}`} className="px-3 pt-1.5 pb-0.5 text-[11px] text-zinc-500">{groupLabel(id.slice(1))}</div>;
                                }
                                const command = commands.get(id);
                                if (!command) return null;
                                const disabled = command.enabled ? !command.enabled() : false;
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => {
                                            setOpen(null);
                                            void command.run();
                                        }}
                                        className="flex w-full items-center justify-between gap-6 px-3 py-1 text-left whitespace-nowrap text-zinc-200 hover:bg-sky-900/50 disabled:opacity-40 disabled:hover:bg-transparent"
                                    >
                                        <span>{command.title()}</span>
                                        {command.keybinding && (
                                            <span className="text-xs text-zinc-500">{formatKeybinding(command.keybinding)}</span>
                                        )}
                                    </button>
                                );
                            })}
                        </motion.div>
                    )}
                </div>
            ))}
            {open !== null && <div className="no-drag fixed inset-0 z-30" onClick={() => setOpen(null)} />}
            <button
                type="button"
                onClick={() => openCommandPalette('')}
                className="absolute left-1/2 flex h-6 w-[min(420px,40vw)] -translate-x-1/2 items-center justify-center gap-2 rounded-md border border-zinc-700 bg-zinc-800/60 text-xs text-zinc-400 hover:bg-zinc-800"
            >
                <Search size={12} />
                <span className="truncate">{name}</span>
            </button>
            <div className="flex-1" />
            <button
                type="button"
                onClick={() => executeCommand('project.wizard')}
                title={t('menuBar.wizardHint')}
                className="mr-2 flex h-6 items-center gap-1.5 rounded-md px-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50"
            >
                <Wand2 size={13} className="text-amber-400" /> {t('menuBar.wizard')}
            </button>
            <LayoutToggles />
            <button
                type="button"
                onClick={() => executeCommand('export.video')}
                className="flex h-6 items-center gap-1.5 rounded-md bg-amber-400 px-2.5 text-xs font-medium text-zinc-950 hover:bg-amber-300"
            >
                <Download size={12} /> {t('menuBar.exportVideo')}
            </button>
        </header>
    );
}
