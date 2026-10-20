// src/agent/webmcp.ts
// 浏览器原生的 WebMCP（navigator.modelContext，仍是提案，只在支持的浏览器 / 扩展里存在）：
// 支持时把同一套工具注册上去，浏览器里的 agent 不用装本地桥就能调用。不支持时什么都不做。
import { AGENT_TOOLS, callAgentTool } from './tools';

interface ModelContextTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: Record<string, unknown>;
    execute: (input: Record<string, unknown>) => Promise<unknown>;
}

interface ModelContext {
    registerTool?: (tool: ModelContextTool) => { unregister?: () => void } | void;
    provideContext?: (context: { tools: ModelContextTool[] }) => void;
}

export const registerWebMcpTools = (): boolean => {
    const context = (globalThis.navigator as Navigator & { modelContext?: ModelContext } | undefined)?.modelContext;
    if (!context) return false;
    const tools: ModelContextTool[] = AGENT_TOOLS.map(tool => ({
        name: `lumisynth_${tool.name}`,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { title: tool.title, readOnlyHint: tool.readOnly },
        execute: input => callAgentTool(tool.name, input),
    }));
    try {
        if (context.provideContext) context.provideContext({ tools });
        else tools.forEach(tool => context.registerTool?.(tool));
        return true;
    } catch (error) {
        console.warn('[lumisynth] WebMCP 注册失败', error);
        return false;
    }
};
