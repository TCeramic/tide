import type { LucideIcon } from 'lucide-react';
import { Settings } from 'lucide-react';
import { motion } from 'motion/react';
import { executeCommand } from './commands';
import { toggleSideView, useLayout, type SideViewId } from './layout';
import { indicatorSpring } from '../motion';
import { useTranslation } from 'react-i18next';

export interface SideViewDefinition {
    id: SideViewId;
    title: string;
    icon: LucideIcon;
    component: () => React.ReactNode;
}

export function ActivityBar({ views }: { views: SideViewDefinition[] }) {
    const active = useLayout(state => state.activeSideView);
    const visible = useLayout(state => state.sideBarVisible);
    const { t } = useTranslation('workbench');
    return (
        <nav className="flex w-12 shrink-0 flex-col items-center border-r border-zinc-800 bg-zinc-900 py-1">
            {views.map(view => {
                const selected = visible && active === view.id;
                const Icon = view.icon;
                return (
                    <button
                        key={view.id}
                        type="button"
                        title={view.title}
                        aria-label={view.title}
                        aria-pressed={selected}
                        onClick={() => toggleSideView(view.id)}
                        className={`relative flex h-12 w-12 items-center justify-center ${selected ? 'text-zinc-50' : 'text-zinc-500 hover:text-zinc-200'}`}
                    >
                        {selected && <motion.span layoutId="activity-indicator" layoutDependency={active} transition={indicatorSpring} className="absolute top-2 bottom-2 left-0 w-0.5 bg-amber-400" />}
                        <Icon size={22} strokeWidth={1.6} />
                    </button>
                );
            })}
            <div className="flex-1" />
            <button
                type="button"
                title={t('activityBar.commandPalette')}
                aria-label={t('activityBar.commandPalette')}
                onClick={() => executeCommand('workbench.commandPalette')}
                className="flex h-12 w-12 items-center justify-center text-zinc-500 hover:text-zinc-200"
            >
                <Settings size={20} strokeWidth={1.6} />
            </button>
        </nav>
    );
}
