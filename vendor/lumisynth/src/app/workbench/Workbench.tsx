// src/app/workbench/Workbench.tsx
// VS Code 式布局：标题栏 / 活动栏 + 主侧栏 | 编辑区 | 辅助栏 / 底部面板（占满整个宽度）/ 状态栏。
import { useRef, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ActivityBar, type SideViewDefinition } from './ActivityBar';
import { CommandPalette } from './CommandPalette';
import { ContextMenu } from './ContextMenu';
import { DropOverlay } from './DropOverlay';
import { QuickPick } from './QuickPick';
import { ErrorBoundary } from './ErrorBoundary';
import { setLayout, useLayout } from './layout';
import { MenuBar, type MenuDefinition } from './MenuBar';
import { Panel, type PanelViewDefinition } from './Panel';
import { Sash } from './Sash';
import { StatusBar, type StatusItem } from './StatusBar';
import { Wizard } from '../wizard/Wizard';
import { useWizard } from '../wizard/wizardStore';
import { fadeIn } from '../motion';
import { useTranslation } from 'react-i18next';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function Workbench({
    menus,
    sideViews,
    panelViews,
    auxBar,
    auxTitle,
    editor,
    statusItems,
}: {
    menus: MenuDefinition[];
    sideViews: SideViewDefinition[];
    panelViews: PanelViewDefinition[];
    auxBar: ReactNode;
    auxTitle: string;
    editor: ReactNode;
    statusItems: StatusItem[];
}) {
    const layout = useLayout();
    const dragStart = useRef(0);
    const { t } = useTranslation('workbench');
    const sideView = sideViews.find(view => view.id === layout.activeSideView) ?? sideViews[0];
    // 向导开着时占住辅助栏的位置（比检查器宽），检查器暂时让开。
    const wizardOpen = useWizard(state => state.open);

    return (
        <div className="flex h-full flex-col bg-zinc-950">
            <MenuBar menus={menus} />
            <div className="flex min-h-0 flex-1">
                <ActivityBar views={sideViews} />
                {layout.sideBarVisible && (
                    <>
                        <aside style={{ width: layout.sideBarWidth }} className="flex shrink-0 flex-col bg-zinc-900/60">
                            <header className="flex h-9 shrink-0 items-center px-4 text-[11px] font-semibold tracking-widest text-zinc-400 uppercase">
                                {sideView.title}
                            </header>
                            <motion.div key={sideView.id} {...fadeIn} className="min-h-0 flex-1 overflow-y-auto">
                                <ErrorBoundary name={sideView.title}>{sideView.component()}</ErrorBoundary>
                            </motion.div>
                        </aside>
                        <Sash
                            orientation="vertical"
                            onDrag={delta => {
                                if (dragStart.current === 0) dragStart.current = layout.sideBarWidth;
                                setLayout({ sideBarWidth: clamp(dragStart.current + delta, 200, 560) });
                            }}
                            onDragEnd={() => { dragStart.current = 0; }}
                        />
                    </>
                )}
                <div className="flex min-w-0 flex-1 flex-col"><ErrorBoundary name={t('editor.area')}>{editor}</ErrorBoundary></div>
                {wizardOpen && <Wizard docked />}
                {!wizardOpen && layout.auxBarVisible && (
                    <>
                        <Sash
                            orientation="vertical"
                            onDrag={delta => {
                                if (dragStart.current === 0) dragStart.current = layout.auxBarWidth;
                                setLayout({ auxBarWidth: clamp(dragStart.current - delta, 220, 560) });
                            }}
                            onDragEnd={() => { dragStart.current = 0; }}
                        />
                        <aside style={{ width: layout.auxBarWidth }} className="flex shrink-0 flex-col bg-zinc-900/60">
                            <header className="flex h-9 shrink-0 items-center px-4 text-[11px] font-semibold tracking-widest text-zinc-400 uppercase">
                                {auxTitle}
                            </header>
                            <div className="min-h-0 flex-1 overflow-y-auto"><ErrorBoundary name={auxTitle}>{auxBar}</ErrorBoundary></div>
                        </aside>
                    </>
                )}
            </div>
            {layout.panelVisible && (
                <>
                    <Sash
                        orientation="horizontal"
                        onDrag={delta => {
                            if (dragStart.current === 0) dragStart.current = layout.panelHeight;
                            setLayout({ panelHeight: clamp(dragStart.current - delta, 120, window.innerHeight * 0.7) });
                        }}
                        onDragEnd={() => { dragStart.current = 0; }}
                    />
                    <div style={{ height: layout.panelHeight }} className="flex shrink-0 flex-col">
                        <Panel views={panelViews} />
                    </div>
                </>
            )}
            <StatusBar items={statusItems} />
            <CommandPalette />
            <QuickPick />
            <ContextMenu />
            <DropOverlay />
        </div>
    );
}
