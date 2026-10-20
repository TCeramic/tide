// src/app/ui.tsx
// 编辑器里反复用到的小部件。样式全部用 Tailwind 工具类。
import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { indicatorSpring } from './motion';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** 滑块已走过部分的比例（全局样式按 --fill 画琥珀色的那一段，见 index.css）。 */
export const rangeFill = (value: number, min: number, max: number): CSSProperties => (
    { '--fill': `${max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0}%` } as CSSProperties
);

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
    default: 'border border-zinc-700 bg-zinc-800/60 hover:bg-zinc-700/70 text-zinc-100',
    primary: 'bg-amber-400 text-zinc-950 hover:bg-amber-300 font-medium',
    ghost: 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50',
    danger: 'border border-red-900 bg-red-950/60 text-red-200 hover:bg-red-900/60',
};

export function Button({
    variant = 'default',
    size = 'md',
    className,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
    return (
        <button
            type="button"
            {...props}
            className={cx(
                'inline-flex items-center justify-center gap-1.5 rounded-md transition-[color,background-color,border-color,transform] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
                size === 'sm' ? 'h-7 px-2 text-xs pointer-coarse:h-10' : 'h-8 px-3 text-sm pointer-coarse:h-11',
                BUTTON_VARIANTS[variant],
                className,
            )}
        />
    );
}

export function FileButton({
    accept,
    onFile,
    onFiles,
    multiple = false,
    children,
    variant,
    size,
    className,
}: {
    accept: string;
    /** 选中一个文件时（multiple 时对每个文件各调一次，除非给了 onFiles）。 */
    onFile?: (file: File) => void;
    /** multiple：一次拿到选中的全部文件。 */
    onFiles?: (files: File[]) => void;
    multiple?: boolean;
    children: ReactNode;
    variant?: ButtonVariant;
    size?: 'sm' | 'md';
    className?: string;
}) {
    const input = useRef<HTMLInputElement>(null);
    return (
        <>
            <Button variant={variant} size={size} className={className} onClick={() => input.current?.click()}>
                {children}
            </Button>
            <input
                ref={input}
                type="file"
                accept={accept}
                multiple={multiple}
                className="hidden"
                onChange={event => {
                    const files = [...(event.target.files ?? [])];
                    event.target.value = '';
                    if (files.length === 0) return;
                    if (onFiles) onFiles(multiple ? files : files.slice(0, 1));
                    else if (onFile) (multiple ? files : files.slice(0, 1)).forEach(onFile);
                }}
            />
        </>
    );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
    return (
        <section className="border-b border-zinc-800 px-4 py-3">
            <header className="mb-2 flex items-center justify-between">
                <h2 className="text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">{title}</h2>
                {actions}
            </header>
            <div className="space-y-2">{children}</div>
        </section>
    );
}

/**
 * 标题 + 控件。用 div 而不是 label：label 包住一组按钮时，第一个按钮会把整段文字当成自己的名字，
 * 点标题文字还会误触它。
 */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
    return (
        <div role="group" aria-label={label} className="block">
            <span className="mb-1 block text-xs text-zinc-400">{label}</span>
            {children}
            {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
        </div>
    );
}

export const inputClass = 'h-8 pointer-coarse:h-11 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-amber-400/70';

export function Segmented<T extends string>({
    value,
    options,
    onChange,
}: {
    value: T;
    options: Array<{ value: T; label: string }>;
    onChange: (value: T) => void;
}) {
    // 选中的底色是一块在选项之间滑动的滑块。位置按容器内的 offsetLeft 量，只在容器里动：
    // 用 layoutId 的话它按页面坐标比对，外面的布局一变（对话框变高、上面展开一段）滑块也跟着飘。
    const container = useRef<HTMLDivElement>(null);
    const [pill, setPill] = useState<{ x: number; width: number; instant: boolean } | null>(null);
    const reduceMotion = useReducedMotion();
    const labels = options.map(option => option.label).join('|');

    useLayoutEffect(() => {
        const root = container.current;
        if (!root) return;
        // instant：容器自己尺寸变了（字体加载、从折叠里展开）时直接到位，只有换选项才滑过去。
        const measure = (instant: boolean) => {
            const button = root.querySelector<HTMLElement>(':scope > button[aria-pressed="true"]');
            const next = button ? { x: button.offsetLeft, width: button.offsetWidth } : null;
            setPill(current => (
                current && next && current.x === next.x && current.width === next.width ? current : next && { ...next, instant }
            ));
        };
        measure(false);
        const observer = new ResizeObserver(() => measure(true));
        observer.observe(root);
        return () => observer.disconnect();
    }, [value, labels]);

    return (
        <div ref={container} className="relative inline-flex rounded-md border border-zinc-700 bg-zinc-900 p-0.5">
            {pill && (
                <motion.span
                    aria-hidden
                    initial={false}
                    animate={{ x: pill.x, width: pill.width }}
                    transition={pill.instant || reduceMotion ? { duration: 0 } : indicatorSpring}
                    className="absolute top-0.5 bottom-0.5 left-0 rounded bg-zinc-700"
                />
            )}
            {options.map(option => (
                <button
                    key={option.value}
                    type="button"
                    aria-pressed={option.value === value}
                    onClick={() => onChange(option.value)}
                    className={cx(
                        'relative h-7 rounded px-2.5 text-xs transition-colors',
                        option.value === value ? 'text-zinc-50' : 'text-zinc-400 hover:text-zinc-100',
                    )}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

export function Slider({
    value,
    min,
    max,
    step,
    onChange,
    format,
}: {
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
    format?: (value: number) => string;
}) {
    return (
        <div className="flex items-center gap-2">
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={event => onChange(Number(event.target.value))}
                style={rangeFill(value, min, max)}
                className="min-w-0 flex-1"
            />
            <span className="w-12 text-right text-xs text-zinc-400 tabular-nums">{format ? format(value) : value}</span>
        </div>
    );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
    return (
        <label className="flex cursor-pointer items-center justify-between gap-2 text-sm text-zinc-300">
            <span>{label}</span>
            <input
                type="checkbox"
                checked={checked}
                onChange={event => onChange(event.target.checked)}
                className="switch"
            />
        </label>
    );
}

export { cx };
