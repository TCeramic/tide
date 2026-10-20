// src/app/workbench/commands.ts
// 命令注册表：菜单、命令面板、快捷键都指向同一个命令 id（VS Code 的做法）。
import { create } from 'zustand';

export interface Command {
    id: string;
    /** 显示时才取文字（跟着界面语言变）。 */
    title: () => string;
    /** 命令面板里显示为「类别: 标题」。 */
    category?: () => string;
    /** 形如 `Ctrl+Shift+P`、`Space`、`F1`。Ctrl 在 macOS 上也匹配 Cmd。 */
    keybinding?: string;
    /** 在输入框里也响应（例如 Ctrl+S）。默认输入框里不触发。 */
    global?: boolean;
    /** 不满足时命令面板里灰掉、快捷键不触发。 */
    enabled?: () => boolean;
    run: () => unknown;
}

interface CommandRegistry {
    commands: Map<string, Command>;
}

export const useCommands = create<CommandRegistry>(() => ({ commands: new Map() }));

export const registerCommands = (commands: Command[]) => {
    const next = new Map(useCommands.getState().commands);
    commands.forEach(command => next.set(command.id, command));
    useCommands.setState({ commands: next });
    return () => {
        const current = new Map(useCommands.getState().commands);
        commands.forEach(command => current.delete(command.id));
        useCommands.setState({ commands: current });
    };
};

export const executeCommand = (id: string) => {
    const command = useCommands.getState().commands.get(id);
    if (!command || (command.enabled && !command.enabled())) return false;
    void command.run();
    return true;
};

const normalizeKey = (key: string) => {
    if (key === ' ') return 'Space';
    if (key.length === 1) return key.toUpperCase();
    return key;
};

export const eventToKeybinding = (event: KeyboardEvent) => {
    const parts: string[] = [];
    if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
    if (event.shiftKey) parts.push('Shift');
    if (event.altKey) parts.push('Alt');
    const key = normalizeKey(event.key);
    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) parts.push(key);
    return parts.join('+');
};

const isTypingTarget = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    if (!element) return false;
    if (element.isContentEditable) return true;
    if (element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') return true;
    if (element.tagName === 'INPUT') {
        const type = (element as HTMLInputElement).type;
        return !['range', 'checkbox', 'radio', 'button', 'color', 'file'].includes(type);
    }
    return false;
};

export const formatKeybinding = (binding: string) => binding
    .split(' ')
    .map(chord => chord.replace(/Ctrl/g, navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'))
    .join(' ');

/** 全局快捷键分发。只在应用启动时装一次。 */
export const installKeybindings = () => {
    const onKeyDown = (event: KeyboardEvent) => {
        const binding = eventToKeybinding(event);
        const typing = isTypingTarget(event.target);
        for (const command of useCommands.getState().commands.values()) {
            if (command.keybinding !== binding) continue;
            if (typing && !command.global) continue;
            if (command.enabled && !command.enabled()) continue;
            event.preventDefault();
            void command.run();
            return;
        }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
};
