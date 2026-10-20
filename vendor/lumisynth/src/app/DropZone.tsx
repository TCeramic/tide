// src/app/DropZone.tsx
// 接收拖放的区域：拖到上方时描边并显示「松开以…」，按这个区域的用途导入。
import type { ReactNode } from 'react';
import { useFileDrop, type DropTarget } from './dropImport';
import { cx } from './ui';

export function DropZone({ target, label, className, children }: { target: DropTarget; label: string; className?: string; children: ReactNode }) {
    const { over, props } = useFileDrop(target);
    return (
        <div {...props} data-drop-target={target} className={cx('relative rounded-md', over && 'ring-2 ring-amber-400', className)}>
            {children}
            {over && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-zinc-950/85 px-2 text-center text-xs text-amber-200">
                    {label}
                </div>
            )}
        </div>
    );
}
