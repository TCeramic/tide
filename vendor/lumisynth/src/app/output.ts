// src/app/output.ts
// 「输出」面板的日志。
import { create } from 'zustand';

export interface LogEntry {
    id: number;
    time: number;
    level: 'info' | 'warn' | 'error';
    message: string;
}

interface OutputState {
    entries: LogEntry[];
}

export const useOutput = create<OutputState>(() => ({ entries: [] }));

let nextId = 1;
export const log = (message: string, level: LogEntry['level'] = 'info') => {
    const entry = { id: nextId++, time: Date.now(), level, message };
    useOutput.setState(state => ({ entries: [...state.entries.slice(-499), entry] }));
};

export const clearOutput = () => useOutput.setState({ entries: [] });
