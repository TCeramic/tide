// src/app/workbench/Panel.tsx
// 底部面板：时间轴 / 问题 / 输出，与 VS Code 一样用标签切换。
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { ErrorBoundary } from './ErrorBoundary';
import { setLayout, showPanelView, useLayout, type PanelViewId } from './layout';
import { fadeIn, indicatorSpring } from '../motion';
import { useTranslation } from 'react-i18next';

export interface PanelViewDefinition {
    id: PanelViewId;
    title: string;
    badge?: () => number | null;
    actions?: () => React.ReactNode;
    component: () => React.ReactNode;
}

export function Panel({ views }: { views: PanelViewDefinition[] }) {
    const active = useLayout(state => state.activePanelView);
    const { t } = useTranslation('workbench');
    const view = views.find(item => item.id === active) ?? views[0];
    return (
        <section className="flex min-h-0 flex-1 flex-col bg-zinc-950">
            <header className="flex h-8 shrink-0 items-center gap-1 px-2">
                {views.map(item => {
                    const badge = item.badge?.();
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => showPanelView(item.id)}
                            className={`relative flex h-8 items-center gap-1.5 px-2 text-[11px] tracking-wider uppercase transition-colors ${item.id === view.id ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >
                            {/* layoutDependency：只在换标签时滑动；拖分隔条改面板高度时不跟着补动画。 */}
                            {item.id === view.id && (
                                <motion.span layoutId="panel-tab-underline" layoutDependency={view.id} transition={indicatorSpring} className="absolute inset-x-0 bottom-0 h-px bg-amber-400" />
                            )}
                            {item.title}
                            {badge ? <span className="rounded-full bg-zinc-700 px-1.5 text-[10px] text-zinc-200">{badge}</span> : null}
                        </button>
                    );
                })}
                <div className="flex-1" />
                {view.actions?.()}
                <button
                    type="button"
                    aria-label={t('panel.close')}
                    onClick={() => setLayout({ panelVisible: false })}
                    className="ml-1 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                >
                    <X size={14} />
                </button>
            </header>
            <motion.div key={view.id} {...fadeIn} className="min-h-0 flex-1 overflow-auto">
                <ErrorBoundary name={view.title}>{view.component()}</ErrorBoundary>
            </motion.div>
        </section>
    );
}
