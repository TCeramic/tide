// src/app/theme-park/themeParkStore.ts
// 主题编辑器的会话状态：一份草稿，只影响预览（预览读这里），点「应用」才写进工程（一步撤销）。
// 放在 store 里而不是组件里：切到别的标签页不丢草稿；关掉「主题」标签页才清掉。
import { create } from 'zustand';
import type { DualTheme, Theme } from '@/core/types';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '@/project/defaults';
import { updateProject, useProjectStore } from '@/project/store';
import { useLayout } from '../workbench/layout';
import {
    COLOR_KEYS,
    normalizeThemeDraft,
    patchDualThemeMode,
    patchDualThemeShared,
    sameEditableTheme,
    type EditableColorKey,
    type EditableMode,
    type ThemeParkTab,
} from './themeParkDraft';

interface ThemeParkState {
    /** 正在编辑的主题（原样保存用户的输入，可能是半成品）；编辑器没开时为 null。 */
    draft: DualTheme | null;
    /** 草稿的基准：打开时 / 上次应用时工程里的主题。「放弃修改」回到这里。 */
    base: DualTheme | null;
    mode: EditableMode;
    colorKey: EditableColorKey;
    tab: ThemeParkTab;
}

export const useThemePark = create<ThemeParkState>(() => ({
    draft: null,
    base: null,
    mode: 'dark',
    colorKey: 'accentColor',
    tab: 'colors',
}));

const projectTheme = () => useProjectStore.getState().project.theme;

/** 编辑器打开时调用：还没有草稿就从工程当前的主题开始。 */
export const openThemeDraft = () => {
    if (useThemePark.getState().draft) return;
    const theme = projectTheme();
    useThemePark.setState({ draft: theme.dual, base: theme.dual, mode: theme.variant });
};

export const closeThemeDraft = () => useThemePark.setState({ draft: null, base: null });

const patchDraft = (update: (draft: DualTheme) => DualTheme) => {
    const { draft } = useThemePark.getState();
    if (draft) useThemePark.setState({ draft: update(draft) });
};

export const setThemeParkMode = (mode: EditableMode) => useThemePark.setState({ mode });
export const setThemeParkColorKey = (colorKey: EditableColorKey) => useThemePark.setState({ colorKey });
export const setThemeParkTab = (tab: ThemeParkTab) => useThemePark.setState({ tab });

/** 当前模式（深 / 浅）上的字段。 */
export const patchThemeMode = (patch: Partial<Theme>, mode: EditableMode = useThemePark.getState().mode) => patchDraft(draft => patchDualThemeMode(draft, mode, patch));
/** 两边共用的字段（关键字颜色、歌词图标）。 */
export const patchThemeShared = (patch: Partial<Theme>) => patchDraft(draft => patchDualThemeShared(draft, patch));
export const setThemeColor = (color: string) => patchThemeMode({ [useThemePark.getState().colorKey]: color });

/** 整份替换（导入 JSON、AI 生成）：先清洗，缺的字段从当前草稿补。 */
export const replaceThemeDraft = (next: DualTheme) => patchDraft(draft => normalizeThemeDraft(next, normalizeThemeDraft(draft)));

/** 放弃修改：回到打开时 / 上次应用时的主题。 */
export const revertThemeDraft = () => {
    const { base } = useThemePark.getState();
    if (base) useThemePark.setState({ draft: base });
};

/** 恢复默认配色：只换四个颜色，名字、描述、关键字与图标保留。 */
export const resetThemeDraftColors = () => patchDraft(draft => {
    const colors = (theme: Theme) => Object.fromEntries(COLOR_KEYS.map(key => [key, theme[key]])) as Partial<Theme>;
    return { light: { ...draft.light, ...colors(DEFAULT_LIGHT_THEME) }, dark: { ...draft.dark, ...colors(DEFAULT_DARK_THEME) } };
});

/** 清洗过、可以渲染的草稿（预览与应用都用这份）。 */
export const resolvedThemeDraft = (draft: DualTheme) => normalizeThemeDraft(draft, projectTheme().dual);

export const isThemeDraftDirty = (state: Pick<ThemeParkState, 'draft' | 'base'> = useThemePark.getState()) => (
    Boolean(state.draft && state.base) && !sameEditableTheme(state.draft!, state.base!)
);

/** 应用：写进工程（一步撤销），标为自定义主题。 */
export const applyThemeDraft = () => {
    const { draft } = useThemePark.getState();
    if (!draft) return false;
    const next = resolvedThemeDraft(draft);
    if (!sameEditableTheme(next, projectTheme().dual)) {
        updateProject(project => ({ ...project, theme: { ...project.theme, source: 'custom', dual: next } }));
    }
    useThemePark.setState({ draft: next, base: next });
    return true;
};

// 工程里的主题在别处变了（撤销、AI 生成、侧栏的快速调色）：基准跟上；草稿没动过就一起换，动过就保留。
// 换了工程：草稿属于上一个工程，直接丢掉（重新从新工程的主题开始）。
let lastDual = projectTheme().dual;
let lastProjectId = useProjectStore.getState().project.id;
useProjectStore.subscribe(state => {
    const dual = state.project.theme.dual;
    if (state.project.id !== lastProjectId) {
        lastProjectId = state.project.id;
        lastDual = dual;
        if (useThemePark.getState().draft) useThemePark.setState({ draft: dual, base: dual, mode: state.project.theme.variant });
        return;
    }
    if (dual === lastDual) return;
    lastDual = dual;
    const current = useThemePark.getState();
    if (!current.draft) return;
    const clean = !isThemeDraftDirty(current);
    useThemePark.setState({ base: dual, ...(clean ? { draft: dual } : {}) });
});

// 关掉「主题」标签页 = 丢掉草稿（预览回到工程里的主题）。
useLayout.subscribe(state => {
    if (!state.editorTabs.includes('theme') && useThemePark.getState().draft) closeThemeDraft();
});
