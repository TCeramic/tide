// src/script/actions.ts
// 剧本与设置的编辑动作：应用（一步撤销），以及给 agent 用的版本号（判断剧本是否过期）。
import { setSession } from '@/project/session';
import { updateProject } from '@/project/store';
import { applyScript, type ApplyScriptResult, type ScriptEnv } from './apply';
import { printScript } from './print';
import { applySettings, type ApplySettingsOptions, type ApplySettingsResult } from './settings';
import type { LumiProject } from '@/project/types';

/** 剧本文本的短哈希（FNV-1a）。 */
export const scriptVersion = (text: string) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

export const currentScript = (env: ScriptEnv) => printScript(env).text;

/** 应用剧本：没有错误时整个结果作为一步写进撤销栈；错误与提示记到「问题」面板。 */
export const commitScript = (text: string, env: ScriptEnv): ApplyScriptResult => {
    const result = applyScript(text, env);
    if (result.ok && result.project !== env.project) updateProject(() => result.project);
    setSession({ scriptProblems: result.diagnostics.filter(item => item.severity !== 'info') });
    return result;
};

/** 应用设置（JSON sidecar）：没有错误时一步写进撤销栈。 */
export const commitSettings = (text: string, project: LumiProject, options?: ApplySettingsOptions): ApplySettingsResult => {
    const result = applySettings(text, project, options);
    if (result.ok && result.project !== project) updateProject(() => result.project);
    setSession({ scriptProblems: result.diagnostics.filter(item => item.severity !== 'info') });
    return result;
};
