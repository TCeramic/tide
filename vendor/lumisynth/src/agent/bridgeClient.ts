// src/agent/bridgeClient.ts
// 页面一侧的本地 MCP 桥客户端（bridge/lumisynth-mcp.mjs）：配对拿令牌、上报工具与提示词目录、
// 长轮询取 agent 的请求、执行后回传。只连 127.0.0.1。令牌存 sessionStorage，刷新页面后自动重连。
import { create } from 'zustand';
import { AGENT_PROMPTS, AGENT_TOOLS, callAgentTool, getAgentPrompt } from './tools';

export const DEFAULT_BRIDGE_PORT = 47863;
const SESSION_KEY = 'lumisynth:agent-bridge';

export type BridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface BridgeState {
    status: BridgeStatus;
    port: number;
    error: string | null;
    /** 最近的工具调用（新的在前）。 */
    activity: Array<{ at: number; tool: string; ok: boolean; summary: string }>;
}

export const useAgentBridge = create<BridgeState>(() => ({
    status: 'disconnected',
    port: DEFAULT_BRIDGE_PORT,
    error: null,
    activity: [],
}));

let session: { port: number; token: string; abort: AbortController } | null = null;

const base = (port: number) => `http://127.0.0.1:${port}`;

const request = async (port: number, path: string, init: RequestInit & { token?: string } = {}) => {
    const { token, ...rest } = init;
    let response: Response;
    try {
        response = await fetch(`${base(port)}${path}`, {
            ...rest,
            headers: {
                ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        });
    } catch (error) {
        if ((error as Error).name === 'AbortError') throw error;
        throw new Error(`连不上 127.0.0.1:${port}：确认 agent 已经启动 lumisynth-mcp，并允许浏览器访问本机网络。`);
    }
    return response;
};

const saveSession = (value: { port: number; token: string } | null) => {
    try {
        if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
        else sessionStorage.removeItem(SESSION_KEY);
    } catch {
        // 隐私模式：刷新后需要重新配对。
    }
};

export const recordAgentActivity = (entry: { tool: string; ok: boolean; summary: string }) => {
    useAgentBridge.setState(state => ({ activity: [{ at: Date.now(), ...entry }, ...state.activity].slice(0, 50) }));
};

const catalog = () => ({
    tools: AGENT_TOOLS.map(tool => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { title: tool.title, readOnlyHint: tool.readOnly, destructiveHint: false, openWorldHint: false },
    })),
    prompts: AGENT_PROMPTS.map(prompt => ({ name: prompt.name, title: prompt.title, description: prompt.description })),
});

const handle = async (message: { id: number; method: string; params?: { name?: string; arguments?: unknown } }) => {
    if (message.method === 'tools/call') {
        const name = String(message.params?.name ?? '');
        const result = await callAgentTool(name, message.params?.arguments);
        return { result };
    }
    if (message.method === 'prompts/get') {
        return { result: getAgentPrompt(String(message.params?.name ?? '')) };
    }
    return { error: `不支持的请求 ${message.method}` };
};

const loop = async (current: NonNullable<typeof session>) => {
    const { port, token, abort } = current;
    while (session === current && !abort.signal.aborted) {
        let response: Response;
        try {
            response = await request(port, '/poll', { token, signal: abort.signal });
        } catch (error) {
            if (abort.signal.aborted) return;
            fail((error as Error).message);
            return;
        }
        if (response.status === 401) {
            fail('令牌已失效（桥重启或被别的页面配对了），请重新配对。');
            return;
        }
        if (response.status === 204) continue;
        if (!response.ok) {
            fail(`桥返回了错误（${response.status}）`);
            return;
        }
        const message = await response.json() as { id: number; method: string; params?: { name?: string; arguments?: unknown } };
        // 不阻塞轮询：导出之类的长任务期间，其他请求照常处理。
        void handle(message)
            .catch(error => ({ error: (error as Error).message || String(error) }))
            .then(reply => request(port, '/reply', { method: 'POST', token, body: JSON.stringify({ id: message.id, ...reply }) }))
            .catch(() => undefined);
    }
};

const fail = (error: string) => {
    session?.abort.abort();
    session = null;
    saveSession(null);
    useAgentBridge.setState({ status: 'error', error });
};

const start = async (port: number, token: string) => {
    const response = await request(port, '/hello', { method: 'POST', token, body: JSON.stringify(catalog()) });
    if (response.status === 401) throw new Error('令牌已失效，请重新配对。');
    if (!response.ok) throw new Error(`桥返回了错误（${response.status}）`);
    session?.abort.abort();
    session = { port, token, abort: new AbortController() };
    saveSession({ port, token });
    useAgentBridge.setState({ status: 'connected', port, error: null });
    void loop(session);
};

export const connectAgentBridge = async (port: number, code: string) => {
    useAgentBridge.setState({ status: 'connecting', port, error: null });
    try {
        const response = await request(port, '/pair', { method: 'POST', body: JSON.stringify({ code: code.trim() }) });
        const data = await response.json().catch(() => ({})) as { token?: string; error?: string };
        if (!response.ok || !data.token) throw new Error(data.error || `配对失败（${response.status}）`);
        await start(port, data.token);
    } catch (error) {
        useAgentBridge.setState({ status: 'error', error: (error as Error).message });
    }
};

export const disconnectAgentBridge = () => {
    const current = session;
    session = null;
    saveSession(null);
    current?.abort.abort();
    if (current) void request(current.port, '/bye', { method: 'POST', token: current.token, keepalive: true }).catch(() => undefined);
    useAgentBridge.setState({ status: 'disconnected', error: null });
};

/** 页面加载时：本标签页之前配对过就直接恢复。 */
export const resumeAgentBridge = async () => {
    let saved: { port: number; token: string } | null = null;
    try {
        saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    } catch {
        saved = null;
    }
    if (!saved?.token) return;
    useAgentBridge.setState({ status: 'connecting', port: saved.port });
    try {
        await start(saved.port, saved.token);
    } catch {
        saveSession(null);
        useAgentBridge.setState({ status: 'disconnected', error: null });
    }
};
