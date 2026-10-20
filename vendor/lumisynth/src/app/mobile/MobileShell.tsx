// src/app/mobile/MobileShell.tsx
// 移动布局（轻量编辑 + 导出）：上方预览与播放条，中间时间轴（单指拖动、双指缩放、点按选中），
// 底部标签栏打开抽屉：素材 / 镜头 / 外观 / AI，以及导出。拖动分词、风格库偏好等精细操作留在桌面布局。
import { useState, type ReactNode } from 'react';
import { Clapperboard, Download, FolderOpen, MoreHorizontal, Palette, Redo2, Sparkles, Undo2, X } from 'lucide-react';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { useSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { executeCommand } from '../workbench/commands';
import { ContextMenu, showContextMenu } from '../workbench/ContextMenu';
import { CommandPalette } from '../workbench/CommandPalette';
import { setLayout } from '../workbench/layout';
import { QuickPick } from '../workbench/QuickPick';
import { AssetsPanel } from '../AssetsPanel';
import { Breadcrumbs } from '../Breadcrumbs';
import { LumiMark } from '../LumiMark';
import { overlay, presence, sheetSpring } from '../motion';
import { Inspector } from '../inspector/Inspector';
import { StylePanel } from '../StylePanel';
import { Timeline } from '../timeline/Timeline';
import { Transport } from '../Transport';
import { cx, Segmented } from '../ui';
import { AiPanel } from '../views/AiPanel';
import { OutlineView } from '../views/OutlineView';
import { openExportDialog } from '../export/ExportDialog';
import { useTranslation } from 'react-i18next';

type Sheet = 'assets' | 'shot' | 'look' | 'ai';

const SHEETS: Record<Sheet, { icon: typeof Palette }> = {
    assets: { icon: FolderOpen },
    shot: { icon: Clapperboard },
    look: { icon: Palette },
    ai: { icon: Sparkles },
};

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
    // 只从标题栏拖：内容区要留给滚动。
    const drag = useDragControls();
    const { t } = useTranslation('common');
    return (
        <motion.div {...presence} variants={overlay} className="fixed inset-0 z-40 flex flex-col justify-end">
            {/* 不压暗：抽屉开着时还要看着上面的预览调。 */}
            <div className="absolute inset-0" onClick={onClose} aria-hidden />
            <motion.section
                role="dialog"
                aria-label={title}
                variants={{ hidden: { y: '100%' }, visible: { y: 0 }, exit: { y: '100%' } }}
                transition={sheetSpring}
                drag="y"
                dragControls={drag}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0.05, bottom: 0.8 }}
                onDragEnd={(_, info) => {
                    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
                }}
                className="relative flex max-h-[72vh] min-h-[40vh] flex-col rounded-t-2xl border-t border-zinc-700 bg-zinc-900 shadow-2xl"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
                <header
                    onPointerDown={event => drag.start(event)}
                    className="flex h-12 shrink-0 touch-none items-center gap-2 border-b border-zinc-800 px-4"
                >
                    <span className="mx-auto h-1 w-10 rounded-full bg-zinc-700 absolute left-1/2 -translate-x-1/2 -mt-9" />
                    <h2 className="flex-1 text-sm font-semibold text-zinc-100">{title}</h2>
                    <button
                        type="button"
                        aria-label={t('close')}
                        onPointerDown={event => event.stopPropagation()}
                        onClick={onClose}
                        className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-400 active:bg-zinc-800"
                    >
                        <X size={18} />
                    </button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
            </motion.section>
        </motion.div>
    );
}

function ShotSheet() {
    const selection = useSession(state => state.selection);
    const [view, setView] = useState<'inspector' | 'outline'>(selection.type === 'none' ? 'outline' : 'inspector');
    const { t } = useTranslation('workbench');
    return (
        <>
            <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900 px-4 py-2">
                <Segmented<'inspector' | 'outline'>
                    value={view}
                    onChange={setView}
                    options={[{ value: 'inspector', label: t('mobile.selection') }, { value: 'outline', label: t('mobile.outline') }]}
                />
            </div>
            {view === 'inspector' ? <Inspector /> : <OutlineView />}
        </>
    );
}

export function MobileShell({ preview }: { preview: ReactNode }) {
    const [sheet, setSheet] = useState<Sheet | null>(null);
    const name = useProjectStore(state => state.project.name);
    const canUndo = useProjectStore(state => state.past.length > 0);
    const canRedo = useProjectStore(state => state.future.length > 0);
    const { t } = useTranslation(['workbench', 'commands']);

    const iconButton = 'flex h-11 w-11 items-center justify-center rounded-full text-zinc-300 active:bg-zinc-800 disabled:opacity-30';

    return (
        <div className="flex h-full flex-col bg-zinc-950" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            {/* titlebar：桌面版里窗口进了移动布局（触屏平板）时，顶栏同样兼做标题栏、给系统窗口按钮让位。 */}
            <header className="titlebar flex h-12 shrink-0 items-center gap-1 border-b border-zinc-800">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
                    <LumiMark className="h-[18px] w-[18px]" />
                    <span>lumi<span className="text-amber-400">synth</span></span>
                </span>
                <span className="min-w-0 flex-1 truncate pl-2 text-xs text-zinc-500">{name}</span>
                <button type="button" aria-label={t('commands:titles.edit.undo')} disabled={!canUndo} onClick={() => useProjectStore.getState().undo()} className={iconButton}><Undo2 size={18} /></button>
                <button type="button" aria-label={t('commands:titles.edit.redo')} disabled={!canRedo} onClick={() => useProjectStore.getState().redo()} className={iconButton}><Redo2 size={18} /></button>
                <button
                    type="button"
                    aria-label={t('mobile.more')}
                    onClick={event => showContextMenu(event, [
                        { label: t('commands:titles.project.new'), run: () => executeCommand('project.new') },
                        { label: t('commands:titles.project.open'), run: () => executeCommand('project.open') },
                        { label: t('mobile.importLumi'), run: () => executeCommand('project.import') },
                        { label: t('mobile.exportLumi'), run: () => executeCommand('project.export') },
                        'separator',
                        { label: t('activityBar.commandPalette'), run: () => executeCommand('workbench.commandPalette') },
                        { label: t('commands:titles.workbench.language'), run: () => executeCommand('workbench.language') },
                        { label: t('commands:titles.view.layoutDesktop'), run: () => setLayout({ uiMode: 'desktop' }) },
                    ])}
                    className={iconButton}
                >
                    <MoreHorizontal size={18} />
                </button>
            </header>
            <div className="flex h-[min(42vh,62vw)] shrink-0 flex-col">
                <Breadcrumbs />
                {preview}
            </div>
            <Transport />
            <div className="min-h-0 flex-1 border-t border-zinc-800">
                <Timeline />
            </div>
            <nav aria-label={t('mobile.nav')} className="flex h-14 shrink-0 items-stretch border-t border-zinc-800 bg-zinc-900" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                {(Object.keys(SHEETS) as Sheet[]).map(id => {
                    const Icon = SHEETS[id].icon;
                    return (
                        <button
                            key={id}
                            type="button"
                            aria-pressed={sheet === id}
                            onClick={() => setSheet(current => (current === id ? null : id))}
                            className={cx('flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]', sheet === id ? 'text-amber-300' : 'text-zinc-400 active:text-zinc-100')}
                        >
                            <Icon size={20} strokeWidth={1.7} />
                            {t(`mobile.sheets.${id}`)}
                        </button>
                    );
                })}
                <button
                    type="button"
                    onClick={() => {
                        setSheet(null);
                        openExportDialog();
                    }}
                    className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-zinc-400 active:text-zinc-100"
                >
                    <Download size={20} strokeWidth={1.7} />
                    {t('mobile.export')}
                </button>
            </nav>
            <AnimatePresence>
                {sheet && (
                    <BottomSheet title={t(`mobile.sheets.${sheet}`)} onClose={() => setSheet(null)}>
                        {sheet === 'assets' && <AssetsPanel />}
                        {sheet === 'shot' && <ShotSheet />}
                        {sheet === 'look' && <StylePanel />}
                        {sheet === 'ai' && <AiPanel />}
                    </BottomSheet>
                )}
            </AnimatePresence>
            <CommandPalette />
            <QuickPick />
            <ContextMenu />
        </div>
    );
}
