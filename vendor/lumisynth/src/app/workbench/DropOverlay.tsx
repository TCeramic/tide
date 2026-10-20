// src/app/workbench/DropOverlay.tsx
// 窗口级的拖放：拖着文件进窗口时盖一层提示；松开在没有专门用途的地方时按文件类型导入。
// 素材卡片、素材库、预览画面自己处理的 drop 已经 preventDefault，这里跳过。
import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { importDroppedFiles, isFileDrag } from '../dropImport';
import { popTransition, presence } from '../motion';
import { useTranslation } from 'react-i18next';

export function DropOverlay() {
    const [active, setActive] = useState(false);
    const depth = useRef(0);
    const { t } = useTranslation('workbench');

    useEffect(() => {
        const reset = () => {
            depth.current = 0;
            setActive(false);
        };
        const onDragEnter = (event: DragEvent) => {
            if (!isFileDrag(event)) return;
            depth.current += 1;
            setActive(true);
        };
        const onDragLeave = (event: DragEvent) => {
            if (!isFileDrag(event)) return;
            depth.current = Math.max(0, depth.current - 1);
            if (depth.current === 0) setActive(false);
        };
        const onDragOver = (event: DragEvent) => {
            if (!isFileDrag(event)) return;
            // 不 preventDefault 的话浏览器会直接打开这个文件。
            event.preventDefault();
            event.dataTransfer!.dropEffect = 'copy';
        };
        const onDrop = (event: DragEvent) => {
            reset();
            if (!isFileDrag(event) || event.defaultPrevented) return;
            event.preventDefault();
            void importDroppedFiles([...event.dataTransfer!.files]);
        };
        window.addEventListener('dragenter', onDragEnter);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('drop', onDrop);
        window.addEventListener('dragend', reset);
        return () => {
            window.removeEventListener('dragenter', onDragEnter);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('drop', onDrop);
            window.removeEventListener('dragend', reset);
        };
    }, []);

    return (
        <AnimatePresence>
            {active && (
                <motion.div
                    {...presence}
                    variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 }, exit: { opacity: 0 } }}
                    transition={popTransition}
                    data-testid="drop-overlay"
                    className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center border-2 border-dashed border-amber-400/70 bg-zinc-950/30 pb-16"
                >
                    <motion.div
                        variants={{ hidden: { opacity: 0, y: 16, scale: 0.97 }, visible: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 8 } }}
                        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                        className="flex max-w-xl flex-col items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/95 px-5 py-3 text-center shadow-2xl"
                    >
                        <div className="flex items-center gap-2 text-sm text-zinc-100">
                            <motion.span
                                animate={{ y: [0, -3, 0] }}
                                transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                                className="inline-flex"
                            >
                                <Upload size={15} className="text-amber-400" />
                            </motion.span>
                            {t('dropOverlay.title')}
                        </div>
                        <div className="text-xs text-zinc-400">{t('dropOverlay.kinds')}</div>
                        <div className="text-[11px] text-zinc-500">{t('dropOverlay.hint')}</div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
