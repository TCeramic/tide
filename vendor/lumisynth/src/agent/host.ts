// src/agent/host.ts
// 工具层读的「当前状态」。编排结果直接从工程与会话现算（写入后立刻读到新结果，不等 React 重渲染）；
// 预览内核活在 React 那边，Preview 创建 / 销毁时写进来。
import { computeProjectState } from '@/app/derived';
import type { LumiKernel } from '@/kernel/runtime';
import { useSession } from '@/project/session';
import { getProject } from '@/project/store';
import { scriptEnv } from '@/script/env';

let currentKernel: LumiKernel | null = null;

export const setPreviewKernel = (kernel: LumiKernel | null) => {
    currentKernel = kernel;
};

export const getPreviewKernel = () => currentKernel;

export const getAgentState = () => {
    const project = getProject();
    const duration = useSession.getState().audioBuffer?.duration ?? null;
    return { project, ...computeProjectState(project, duration) };
};

/** 剧本的上下文（剧本自己编一份编排，不带界面上「试看」的临时修改）。 */
export const getScriptEnv = () => scriptEnv(getProject(), useSession.getState().audioBuffer?.duration ?? null);
