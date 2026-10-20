// src/app/workbench/Sash.tsx
// 可拖拽的分隔条。拖动时报告相对起点的位移，由调用方换算成尺寸。
import { useRef } from 'react';

export function Sash({
    orientation,
    onDrag,
    onDragEnd,
    onDoubleClick,
}: {
    /** vertical：竖条，左右拖；horizontal：横条，上下拖。 */
    orientation: 'vertical' | 'horizontal';
    onDrag: (delta: number) => void;
    onDragEnd?: () => void;
    onDoubleClick?: () => void;
}) {
    const origin = useRef<number | null>(null);
    const vertical = orientation === 'vertical';
    return (
        <div
            role="separator"
            aria-orientation={vertical ? 'vertical' : 'horizontal'}
            onDoubleClick={onDoubleClick}
            onPointerDown={event => {
                event.preventDefault();
                (event.target as HTMLElement).setPointerCapture(event.pointerId);
                origin.current = vertical ? event.clientX : event.clientY;
                document.body.style.cursor = vertical ? 'col-resize' : 'row-resize';
            }}
            onPointerMove={event => {
                if (origin.current === null) return;
                onDrag((vertical ? event.clientX : event.clientY) - origin.current);
            }}
            onPointerUp={event => {
                if (origin.current === null) return;
                (event.target as HTMLElement).releasePointerCapture(event.pointerId);
                origin.current = null;
                document.body.style.cursor = '';
                onDragEnd?.();
            }}
            className={`group relative z-10 shrink-0 ${vertical ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'} bg-zinc-800`}
        >
            <div
                className={`absolute transition-colors group-hover:bg-sky-500/70 ${vertical ? '-inset-x-[2px] inset-y-0' : '-inset-y-[2px] inset-x-0'}`}
            />
        </div>
    );
}
