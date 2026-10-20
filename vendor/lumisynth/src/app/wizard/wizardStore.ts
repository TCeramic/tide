// src/app/wizard/wizardStore.ts
// 快速制作向导的状态：开没开、在第几步、配色选的是哪一种。每一步的选择直接写进工程（可以撤销），
// 预览在抽屉左边实时变化——向导本身不保存一份独立的设置。
import { create } from 'zustand';
import type { DualTheme } from '@/core/types';
import { newProject, openProject } from '@/project/actions';
import { deleteProjectRow } from '@/project/db';
import { useProjectStore } from '@/project/store';

/** 步骤的 id（名字在 wizard:steps 里）。 */
export const WIZARD_STEPS = ['song', 'style', 'assets', 'theme', 'done'] as const;
export type ThemeSource = 'default' | 'cover' | 'ai' | 'random';

interface WizardState {
    open: boolean;
    step: number;
    /** 配色这一步选中的来源（高亮用；工程里的主题才是实际的结果）。 */
    themeSource: ThemeSource | null;
    /** 这次向导里 AI 生成的主题：切到别的来源再切回来不用重新生成。 */
    aiTheme: DualTheme | null;
    /**
     * 从有歌的工程进来时新建了空工程：记下原来的工程。取消时新工程还是空的，就切回去并删掉这个空工程
     * （取消 = 什么都没发生，也不留下一串空的「未命名工程」）。
     */
    returnTo: { projectId: string; createdId: string } | null;
    /** 本次会话里关过向导（或点了 ×）的工程：空工程上的引导卡片不再弹出来。 */
    dismissed: string[];
}

export const useWizard = create<WizardState>(() => ({ open: false, step: 0, themeSource: null, aiTheme: null, returnTo: null, dismissed: [] }));

const projectHasContent = () => {
    const { project } = useProjectStore.getState();
    return Boolean(project.audio || project.lyrics);
};

/**
 * 打开向导。fresh：当前工程已经有歌了就先新建一个空工程（当前工程已自动保存，可以从「打开工程」回来）；
 * 从空工程里的「开始制作」卡片进来时不新建。
 */
export const openWizard = async ({ fresh }: { fresh: boolean }) => {
    let returnTo: WizardState['returnTo'] = null;
    if (fresh && projectHasContent()) {
        const previous = useProjectStore.getState().project.id;
        await newProject();
        returnTo = { projectId: previous, createdId: useProjectStore.getState().project.id };
    }
    useWizard.setState({ open: true, step: 0, themeSource: null, aiTheme: null, returnTo });
};

export const dismissEmptyStageCard = (projectId: string) => useWizard.setState(state => ({
    dismissed: state.dismissed.includes(projectId) ? state.dismissed : [...state.dismissed, projectId],
}));

export const closeWizard = () => {
    const { returnTo } = useWizard.getState();
    const current = useProjectStore.getState().project.id;
    useWizard.setState({ open: false, returnTo: null });
    dismissEmptyStageCard(current);
    // 取消了一个还空着的新工程：回到原来的工程，删掉这个空工程。
    if (returnTo && current === returnTo.createdId && !projectHasContent()) {
        void openProject(returnTo.projectId)
            .then(() => deleteProjectRow(returnTo.createdId))
            .catch(error => console.warn('[wizard] 回到原来的工程失败', error));
    }
};
export const setWizardStep = (step: number) => useWizard.setState({ step: Math.max(0, Math.min(WIZARD_STEPS.length - 1, step)) });
export const setWizardThemeSource = (themeSource: ThemeSource) => useWizard.setState({ themeSource });
export const setWizardAiTheme = (aiTheme: DualTheme) => useWizard.setState({ aiTheme });
