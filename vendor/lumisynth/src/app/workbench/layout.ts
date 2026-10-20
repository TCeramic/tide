// src/app/workbench/layout.ts
// Workbench 布局（仿 VS Code）：活动栏 + 主侧栏、编辑区、底部面板、右侧辅助栏、状态栏。
// 布局是每个浏览器自己的偏好，存 localStorage，不进工程文件。
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type SideViewId = 'assets' | 'outline' | 'look' | 'library' | 'assetLibrary' | 'ai' | 'agent';
export type PanelViewId = 'timeline' | 'problems' | 'output';
/** 编辑区的标签页：预览始终在；风格库、设置可以作为标签页打开。 */
export type EditorTabId = 'preview' | 'library' | 'settings' | 'script' | 'lyrics' | 'theme' | 'storyboard';

export interface LayoutState {
    sideBarVisible: boolean;
    sideBarWidth: number;
    activeSideView: SideViewId;
    panelVisible: boolean;
    panelHeight: number;
    activePanelView: PanelViewId;
    auxBarVisible: boolean;
    auxBarWidth: number;
    commandPaletteOpen: boolean;
    commandPaletteQuery: string;
    /** 时间轴缩放（像素 / 秒）与播放时是否跟随播放头滚动。 */
    timelineZoom: number;
    timelineFollow: boolean;
    /** 歌词轨的精确（逐字）模式。 */
    timelineWords: boolean;
    editorTabs: EditorTabId[];
    activeEditorTab: EditorTabId;
    /** 左右分栏：左边固定是预览，右边是当前的其他标签页。 */
    editorSplit: boolean;
    /** 界面：auto 按屏宽与触控自动选，也可以固定为桌面 / 移动布局。 */
    uiMode: 'auto' | 'desktop' | 'mobile';
    /** 预览音量（0–1）与静音：只影响预览，不进工程、不影响导出。 */
    previewVolume: number;
    previewMuted: boolean;
}

const memoryStorage = new Map<string, string>();
const safeStorage: StateStorage = {
    getItem: name => {
        try { return localStorage.getItem(name); } catch { return memoryStorage.get(name) ?? null; }
    },
    setItem: (name, value) => {
        try { localStorage.setItem(name, value); } catch { memoryStorage.set(name, value); }
    },
    removeItem: name => {
        try { localStorage.removeItem(name); } catch { memoryStorage.delete(name); }
    },
};

export const useLayout = create<LayoutState>()(persist(
    (): LayoutState => ({
        sideBarVisible: true,
        sideBarWidth: 288,
        activeSideView: 'assets',
        panelVisible: true,
        panelHeight: 240,
        activePanelView: 'timeline',
        auxBarVisible: true,
        auxBarWidth: 300,
        commandPaletteOpen: false,
        commandPaletteQuery: '',
        timelineZoom: 40,
        timelineFollow: true,
        timelineWords: false,
        editorTabs: ['preview'],
        activeEditorTab: 'preview',
        editorSplit: false,
        uiMode: 'auto',
        previewVolume: 1,
        previewMuted: false,
    }),
    {
        name: 'lumisynth:layout',
        storage: createJSONStorage(() => safeStorage),
        partialize: state => ({
            sideBarVisible: state.sideBarVisible,
            sideBarWidth: state.sideBarWidth,
            activeSideView: state.activeSideView,
            panelVisible: state.panelVisible,
            panelHeight: state.panelHeight,
            activePanelView: state.activePanelView,
            auxBarVisible: state.auxBarVisible,
            auxBarWidth: state.auxBarWidth,
            timelineZoom: state.timelineZoom,
            timelineFollow: state.timelineFollow,
            timelineWords: state.timelineWords,
            editorTabs: state.editorTabs,
            activeEditorTab: state.activeEditorTab,
            editorSplit: state.editorSplit,
            uiMode: state.uiMode,
            previewVolume: state.previewVolume,
            previewMuted: state.previewMuted,
        }),
    },
));

export const setLayout = (patch: Partial<LayoutState>) => useLayout.setState(patch);

/** VS Code 的行为：点当前视图的图标收起侧栏，点别的图标切换并展开。 */
export const toggleSideView = (view: SideViewId) => {
    const { activeSideView, sideBarVisible } = useLayout.getState();
    if (view === activeSideView && sideBarVisible) setLayout({ sideBarVisible: false });
    else setLayout({ activeSideView: view, sideBarVisible: true });
};

export const showPanelView = (view: PanelViewId) => setLayout({ activePanelView: view, panelVisible: true });

export const openCommandPalette = (query = '>') => setLayout({ commandPaletteOpen: true, commandPaletteQuery: query });
export const closeCommandPalette = () => setLayout({ commandPaletteOpen: false });

export const openEditorTab = (tab: EditorTabId, split?: boolean) => {
    const { editorTabs } = useLayout.getState();
    setLayout({
        editorTabs: editorTabs.includes(tab) ? editorTabs : [...editorTabs, tab],
        activeEditorTab: tab,
        ...(split !== undefined ? { editorSplit: split } : {}),
    });
};

export const closeEditorTab = (tab: EditorTabId) => {
    if (tab === 'preview') return;
    const { editorTabs, activeEditorTab } = useLayout.getState();
    const next = editorTabs.filter(item => item !== tab);
    setLayout({ editorTabs: next, activeEditorTab: activeEditorTab === tab ? next.at(-1) ?? 'preview' : activeEditorTab });
};
