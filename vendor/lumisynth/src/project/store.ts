// src/project/store.ts
// 工程状态与撤销/重做。工程是不可变数据：每次修改产出一个新对象，历史栈直接存快照。
// 连续的同类修改（拖滑块、拖时间轴）用 coalesce key 合并成一步。
import { create } from 'zustand';
import { createProject } from './defaults';
import type { LumiProject } from './types';

const HISTORY_LIMIT = 200;
const COALESCE_WINDOW_MS = 800;

export interface UpdateOptions {
    /** false：不进撤销栈（例如自动写回的派生数据）。 */
    history?: boolean;
    /** 相同 key 且间隔很短的修改合并为一步撤销。 */
    coalesce?: string;
}

interface ProjectState {
    project: LumiProject;
    past: LumiProject[];
    future: LumiProject[];
    lastCoalesce: { key: string; at: number } | null;
    update: (recipe: (project: LumiProject) => LumiProject, options?: UpdateOptions) => void;
    undo: () => void;
    redo: () => void;
    /** 换成另一个工程（打开 / 新建 / 导入），清空历史。 */
    replace: (project: LumiProject) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
    project: createProject(),
    past: [],
    future: [],
    lastCoalesce: null,
    update: (recipe, options = {}) => {
        const { project, past, lastCoalesce } = get();
        const next = recipe(project);
        if (next === project) return;
        const stamped = { ...next, updatedAt: Date.now() };
        if (options.history === false) {
            set({ project: stamped });
            return;
        }
        const now = Date.now();
        const coalesced = options.coalesce !== undefined
            && lastCoalesce?.key === options.coalesce
            && now - lastCoalesce.at < COALESCE_WINDOW_MS;
        set({
            project: stamped,
            past: coalesced ? past : [...past, project].slice(-HISTORY_LIMIT),
            future: [],
            lastCoalesce: options.coalesce !== undefined ? { key: options.coalesce, at: now } : null,
        });
    },
    undo: () => {
        const { project, past, future } = get();
        const previous = past.at(-1);
        if (!previous) return;
        set({ project: previous, past: past.slice(0, -1), future: [project, ...future], lastCoalesce: null });
    },
    redo: () => {
        const { project, past, future } = get();
        const next = future[0];
        if (!next) return;
        set({ project: next, past: [...past, project], future: future.slice(1), lastCoalesce: null });
    },
    replace: project => set({ project, past: [], future: [], lastCoalesce: null }),
}));

export const updateProject = (recipe: (project: LumiProject) => LumiProject, options?: UpdateOptions) => (
    useProjectStore.getState().update(recipe, options)
);

export const getProject = () => useProjectStore.getState().project;
