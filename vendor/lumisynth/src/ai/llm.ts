// src/ai/llm.ts
// 让模型按 JSON Schema 输出一个 JSON 对象。浏览器直连用户自己配置的提供方（src/ai/settings.ts）：
//   Gemini REST（responseJsonSchema）
//   OpenAI 兼容 chat/completions（OpenAI 本家用 json_schema，其余用 JSON 模式、schema 写进提示词；
//     复用 folia 的传输层，它会记住各家服务拒绝过的参数）
//   Anthropic Messages（强制调用一个以 schema 为参数的工具）
// 提供方必须允许浏览器跨域访问；不允许时 fetch 直接失败，这里给出可读的原因。
import type { ResolvedAiProvider } from './settings';
import { DEFAULT_MODELS } from './settings';
import { t } from '@/i18n';
import {
    detectOpenAICompatibleProvider,
    rejectsOpenAICompatibleParameter,
    sendOpenAICompatibleRequest,
} from './vendor/openAICompatibleRequest.mjs';

export class AiRequestError extends Error {
    constructor(message: string, readonly status = 500) {
        super(message);
        this.name = 'AiRequestError';
    }
}

export interface JsonRequest {
    system: string;
    user: string;
    schemaName: string;
    /** 标准 JSON Schema（OpenAI 的 json_schema、Gemini 的 responseJsonSchema、Anthropic 的 input_schema 都接受）。 */
    schema: Record<string, unknown>;
    maxOutputTokens?: number;
    temperature?: number;
}

const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 120_000;

const linkSignal = (signal?: AbortSignal) => {
    const timeout = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
    if (!signal) return timeout;
    if (!timeout) return signal;
    return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal;
};

/** 与 folia 相同：只有根路径或 `/vN` 结尾时补上 chat/completions，其他路径原样使用。 */
export const normalizeOpenAIUrl = (raw: string | undefined) => {
    const trimmed = raw?.trim();
    if (!trimmed) return DEFAULT_OPENAI_URL;
    try {
        const parsed = new URL(trimmed);
        const path = parsed.pathname.replace(/\/+$/, '');
        if (!path || path === '/') parsed.pathname = '/v1/chat/completions';
        else if (/\/v\d+$/.test(path)) parsed.pathname = `${path}/chat/completions`;
        else parsed.pathname = path;
        return parsed.toString();
    } catch {
        return trimmed.replace(/\/+$/, '');
    }
};

const resolveOpenAIModel = (apiUrl: string, configured: string) => {
    if (configured.trim()) return configured.trim();
    return detectOpenAICompatibleProvider(apiUrl) === 'deepseek' ? DEEPSEEK_DEFAULT_MODEL : DEFAULT_MODELS.openai;
};

const readErrorDetail = async (response: Response) => {
    try {
        return (await response.text()).slice(0, 600);
    } catch {
        return '';
    }
};

/** fetch 本身失败（不是 HTTP 错误）：断网、地址错，或者该服务不允许浏览器跨域。 */
/** 接口返回错误状态码时给用户看的说明。 */
const apiError = (label: string, status: number, detail: string | undefined | null) => (
    detail ? t('ai:errors.apiDetail', { label, status, detail }) : t('ai:errors.api', { label, status })
);

const send = async (label: string, url: string, init: RequestInit, userSignal?: AbortSignal, via?: () => Promise<Response>) => {
    try {
        return await (via ? via() : fetch(url, init));
    } catch (error) {
        // 用户取消：原样抛出，由调用方按 signal.aborted 处理。
        if (userSignal?.aborted) throw error;
        const name = (error as Error).name;
        if (name === 'TimeoutError' || name === 'AbortError') throw new AiRequestError(t('ai:errors.timeout', { label }), 504);
        throw new AiRequestError(t('ai:errors.unreachable', { label, host: new URL(url).host }), 0);
    }
};

const extractText = (message: { content?: unknown } | undefined) => {
    const content = message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(part => (typeof part?.text === 'string' ? part.text : '')).join('');
    return '';
};

const runOpenAI = async (request: JsonRequest, provider: ResolvedAiProvider, signal?: AbortSignal): Promise<string> => {
    const apiUrl = normalizeOpenAIUrl(provider.config.baseUrl);
    const model = resolveOpenAIModel(apiUrl, provider.config.model);
    const vendor = detectOpenAICompatibleProvider(apiUrl);
    const strict = vendor === 'openai';
    const body: Record<string, unknown> = {
        model,
        messages: [
            { role: 'system', content: strict ? request.system : `${request.system}\n\nJSON Schema of the response:\n${JSON.stringify(request.schema)}` },
            { role: 'user', content: request.user },
        ],
        temperature: provider.config.temperature ?? request.temperature ?? 0.7,
        [strict ? 'max_completion_tokens' : 'max_tokens']: request.maxOutputTokens ?? 8000,
        response_format: strict
            ? { type: 'json_schema', json_schema: { name: request.schemaName, strict: false, schema: request.schema } }
            : { type: 'json_object' },
        ...(vendor === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
    };
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
    const init: RequestInit = { method: 'POST', headers, signal: linkSignal(signal) };

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await send(t('ai:errors.openaiLabel'), apiUrl, init, signal, () => sendOpenAICompatibleRequest({ apiUrl, provider: vendor, body, init }));
        if (!response.ok) {
            const detail = await readErrorDetail(response);
            // 有的推理模型只接受默认温度。
            if (attempt < 2 && 'temperature' in body && rejectsOpenAICompatibleParameter(response.status, detail, 'temperature')) {
                delete body.temperature;
                continue;
            }
            throw new AiRequestError(apiError(t('ai:errors.openaiLabel'), response.status, detail), response.status);
        }
        const data = await response.json() as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> };
        const text = extractText(data.choices?.[0]?.message);
        if (!text) throw new AiRequestError(t('ai:errors.emptyWithReason', { reason: `finish_reason: ${data.choices?.[0]?.finish_reason ?? '?'}` }), 502);
        return text;
    }
    throw new AiRequestError(t('ai:errors.failed'), 502);
};

const runGemini = async (request: JsonRequest, provider: ResolvedAiProvider, signal?: AbortSignal): Promise<string> => {
    const model = provider.config.model.trim() || DEFAULT_MODELS.gemini;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await send('Gemini', url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.apiKey },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ role: 'user', parts: [{ text: request.user }] }],
            generationConfig: {
                responseMimeType: 'application/json',
                responseJsonSchema: request.schema,
                maxOutputTokens: request.maxOutputTokens ?? 8000,
                temperature: provider.config.temperature ?? request.temperature ?? 0.7,
            },
        }),
        signal: linkSignal(signal),
    }, signal);
    if (!response.ok) {
        const detail = await readErrorDetail(response);
        throw new AiRequestError(apiError('Gemini', response.status, detail), response.status);
    }
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.find(part => typeof part.text === 'string')?.text;
    if (!text) throw new AiRequestError(t('ai:errors.empty'), 502);
    return text;
};

const runAnthropic = async (request: JsonRequest, provider: ResolvedAiProvider, signal?: AbortSignal): Promise<string> => {
    const url = provider.config.baseUrl.trim() || ANTHROPIC_URL;
    const temperature = provider.config.temperature ?? request.temperature;
    const response = await send('Anthropic', url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': provider.apiKey,
            'anthropic-version': '2023-06-01',
            // 浏览器直连必须显式声明（密钥由用户自己提供，只在本机）。
            'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
            model: provider.config.model.trim() || DEFAULT_MODELS.anthropic,
            max_tokens: request.maxOutputTokens ?? 8000,
            system: request.system,
            messages: [{ role: 'user', content: request.user }],
            tools: [{ name: request.schemaName, description: 'Return the result through this tool.', input_schema: request.schema }],
            tool_choice: { type: 'tool', name: request.schemaName },
            ...(temperature !== undefined ? { temperature: Math.min(1, temperature) } : {}),
        }),
        signal: linkSignal(signal),
    }, signal);
    if (!response.ok) {
        const detail = await readErrorDetail(response);
        throw new AiRequestError(apiError('Anthropic', response.status, detail), response.status);
    }
    const data = await response.json() as { content?: Array<{ type: string; input?: unknown; text?: string }>; stop_reason?: string };
    const tool = data.content?.find(block => block.type === 'tool_use');
    if (tool?.input !== undefined) return JSON.stringify(tool.input);
    const text = data.content?.find(block => block.type === 'text')?.text;
    if (text) return text;
    throw new AiRequestError(t('ai:errors.emptyWithReason', { reason: `stop_reason: ${data.stop_reason ?? '?'}` }), 502);
};

export const PROVIDER_DISPLAY: Record<ResolvedAiProvider['kind'], string> = {
    gemini: 'Google Gemini',
    openai: 'OpenAI compatible',
    anthropic: 'Anthropic Claude',
};

/** 调模型，返回原始文本（分词等需要自己解析的场合）。 */
export const generateText = (request: JsonRequest, provider: ResolvedAiProvider, signal?: AbortSignal) => (
    provider.kind === 'openai' ? runOpenAI(request, provider, signal)
        : provider.kind === 'anthropic' ? runAnthropic(request, provider, signal)
            : runGemini(request, provider, signal)
);

/** 调模型并解析出 JSON 对象。 */
export const generateJson = async <T>(request: JsonRequest, provider: ResolvedAiProvider, signal?: AbortSignal): Promise<{ value: T; provider: string }> => {
    const raw = await generateText(request, provider, signal);
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try {
        return { value: JSON.parse(cleaned) as T, provider: PROVIDER_DISPLAY[provider.kind] };
    } catch {
        console.error('[ai] unparsable response:', cleaned.slice(0, 2000));
        throw new AiRequestError(t('ai:errors.invalidJson'), 502);
    }
};
