// src/app/workbench/StatusBar.tsx
// 状态栏：左侧是工程与后台任务状态，右侧是当前画面的关键设置；点击项执行命令。
import type { ReactNode } from 'react';
import { executeCommand } from './commands';

export interface StatusItem {
    id: string;
    side: 'left' | 'right';
    content: ReactNode;
    title?: string;
    command?: string;
    tone?: 'default' | 'warning' | 'error';
}

export function StatusBar({ items }: { items: StatusItem[] }) {
    const render = (item: StatusItem) => (
        <button
            key={item.id}
            type="button"
            title={item.title}
            disabled={!item.command}
            onClick={() => item.command && executeCommand(item.command)}
            className={`flex h-full items-center gap-1 px-2 whitespace-nowrap transition-colors enabled:hover:bg-white/5 enabled:hover:text-zinc-200 ${item.tone === 'error' ? 'bg-red-950/70 text-red-300' : item.tone === 'warning' ? 'text-amber-300' : ''}`}
        >
            {item.content}
        </button>
    );
    return (
        <footer className="flex h-6 shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-900 text-[11px] text-zinc-400">
            <div className="flex h-full min-w-0 items-center overflow-hidden">{items.filter(i => i.side === 'left').map(render)}</div>
            <div className="flex h-full items-center">{items.filter(i => i.side === 'right').map(render)}</div>
        </footer>
    );
}
