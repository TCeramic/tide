// src/ai/client.ts
// AI 的三个请求（主题、分词、场景编排）与「测试连接」。浏览器直连用户配置的提供方（src/ai/settings.ts），
// 提示词、输出契约与清洗与 folia 相同。
import type { DualTheme } from '@/core/types';
import { AiRequestError, generateJson, generateText, PROVIDER_DISPLAY } from './llm';
import {
    buildSceneDirectionPrompt,
    sanitizeSceneDirection,
    SCENE_DIRECTION_SCHEMA,
    SCENE_DIRECTION_SYSTEM_PROMPT,
    type SceneDirectionRequest,
    type SceneDirectionResponse,
} from './sceneDirection';
import { resolveAiProvider, type ResolvedAiProvider } from './settings';
import { t } from '@/i18n';
import { buildThemeSourcePrompt, THEME_GENERATION_PROMPT_PREFIX } from './themePrompt';
import {
    SEGMENTATION_JSON_SCHEMA,
    SEGMENTATION_MAX_OUTPUT_TOKENS,
    SEGMENTATION_SCHEMA_NAME,
    buildSegmentationSourcePrompt,
    buildSegmentationSystemPrompt,
    parseSegmentationResponse,
} from './vendor/lyricSegmentationPrompt.mjs';
import { segmentLyricLines } from './vendor/lyricSegmentationService.mjs';
import { sanitizeDualTheme } from './vendor/themeSanitizer.mjs';

export { AiRequestError } from './llm';

const requireProvider = (): ResolvedAiProvider => {
    const provider = resolveAiProvider();
    if (!provider) throw new AiRequestError(t('ai:errors.notConfigured'), 0);
    return provider;
};

// ---------------------------------------------------------------------------------------------
// 主题

const themeSchema = (mode: 'light' | 'dark') => ({
    type: 'object',
    description: `Theme optimized for ${mode} mode`,
    properties: {
        name: { type: 'string', description: `A creative name for this ${mode} theme in Chinese, strictly limited to 10 characters or less` },
        description: { type: 'string', description: 'A creative 1-sentence description of the mood in Chinese, 15 to 30 Chinese characters' },
        backgroundColor: { type: 'string', description: `Hex code for ${mode} background` },
        primaryColor: { type: 'string', description: 'Hex code for main text' },
        accentColor: { type: 'string', description: 'Hex code for highlighted text/effects' },
        secondaryColor: { type: 'string', description: 'Hex code for secondary text (must contrast with the background)' },
        wordColors: {
            type: 'array',
            description: 'Exact emotional standalone words from the source text and their colors; Latin-script words must not contain punctuation or spaces',
            items: {
                type: 'object',
                properties: { word: { type: 'string' }, color: { type: 'string' } },
                required: ['word', 'color'],
            },
        },
        lyricsIcons: { type: 'array', description: 'Lucide icon names related to the source text', items: { type: 'string' } },
    },
    required: ['name', 'backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor', 'wordColors', 'lyricsIcons'],
});

export const THEME_SCHEMA = {
    type: 'object',
    properties: { light: themeSchema('light'), dark: themeSchema('dark') },
    required: ['light', 'dark'],
};

/** 把模型（或外部 agent）给的主题清洗成 DualTheme。 */
export const sanitizeThemeResult = (value: unknown, provider: string): DualTheme => {
    const dual = sanitizeDualTheme(value) as DualTheme;
    dual.light.fontStyle = 'sans';
    dual.dark.fontStyle = 'sans';
    dual.light.provider = provider;
    dual.dark.provider = provider;
    return dual;
};

export const requestTheme = async (lyricsText: string, isPureMusic: boolean, songTitle: string, signal?: AbortSignal): Promise<DualTheme> => {
    const { value, provider } = await generateJson<unknown>({
        system: THEME_GENERATION_PROMPT_PREFIX,
        user: buildThemeSourcePrompt(lyricsText.slice(0, 2000), isPureMusic, songTitle),
        schemaName: 'dual_theme',
        schema: THEME_SCHEMA,
        maxOutputTokens: 4000,
    }, requireProvider(), signal);
    return sanitizeThemeResult(value, provider);
};

// ---------------------------------------------------------------------------------------------
// 分词

/** 给 folia 分词服务的 fetch：接上用户的取消信号，并把跨域 / 断网失败换成可读的原因。 */
const segmentationFetch = (signal?: AbortSignal): typeof fetch => async (input, init) => {
    const signals = [init?.signal, signal].filter(Boolean) as AbortSignal[];
    const linked = signals.length > 1 && typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : signals[0];
    try {
        return await fetch(input, { ...init, signal: linked });
    } catch (error) {
        if (signal?.aborted || (error as Error).name === 'AbortError' || (error as Error).name === 'TimeoutError') throw error;
        const host = (() => { try { return new URL(String(input)).host; } catch { return String(input); } })();
        throw new AiRequestError(t('ai:errors.unreachable', { label: host, host }), 0);
    }
};

export const requestSegmentation = async (lines: string[], signal?: AbortSignal): Promise<{ lines: string[][] }> => {
    const provider = requireProvider();
    if (provider.kind === 'anthropic') {
        // folia 的分词服务只认 Gemini / OpenAI 兼容；Claude 用同一套提示词与校验，经通用的 JSON 通道。
        const raw = await generateText({
            system: buildSegmentationSystemPrompt(),
            user: buildSegmentationSourcePrompt(lines),
            schemaName: SEGMENTATION_SCHEMA_NAME,
            schema: SEGMENTATION_JSON_SCHEMA,
            maxOutputTokens: SEGMENTATION_MAX_OUTPUT_TOKENS * 2,
            temperature: 0,
        }, provider, signal);
        const { boundaries } = parseSegmentationResponse(raw, lines);
        return { lines: boundaries };
    }
    const { config } = provider;
    const env = provider.kind === 'gemini'
        ? { GEMINI_API_KEY: provider.apiKey, GEMINI_MODEL: config.model.trim() || undefined }
        : {
            AI_PROVIDER: 'openai',
            OPENAI_API_KEY: provider.apiKey || 'none',
            OPENAI_API_URL: config.baseUrl,
            OPENAI_API_MODEL: config.model,
            OPENAI_API_TEMPERATURE: config.temperature === null ? undefined : String(config.temperature),
        };
    try {
        return { lines: await segmentLyricLines(lines, env, segmentationFetch(signal)) };
    } catch (error) {
        if (error instanceof AiRequestError || signal?.aborted) throw error;
        throw new AiRequestError((error as Error).message, (error as { status?: number }).status ?? 502);
    }
};

// ---------------------------------------------------------------------------------------------
// 场景编排

export const MAX_DIRECTION_PARAGRAPHS = 120;

export const requestSceneDirection = async (request: SceneDirectionRequest, signal?: AbortSignal): Promise<SceneDirectionResponse & { provider?: string }> => {
    if (request.packs.length === 0 || request.paragraphs.length === 0) throw new AiRequestError(t('ai:errors.noParagraphs'), 400);
    if (request.paragraphs.length > MAX_DIRECTION_PARAGRAPHS) throw new AiRequestError(t('ai:errors.tooManyParagraphs'), 400);
    const { value, provider } = await generateJson<unknown>({
        system: SCENE_DIRECTION_SYSTEM_PROMPT,
        user: buildSceneDirectionPrompt(request),
        schemaName: 'scene_direction',
        schema: SCENE_DIRECTION_SCHEMA,
        maxOutputTokens: 6000,
        temperature: 0.6,
    }, requireProvider(), signal);
    return { ...sanitizeSceneDirection(value, request), provider };
};

// ---------------------------------------------------------------------------------------------
// 测试连接

/** 发一个最小的请求，确认密钥、地址、模型与跨域都没问题。返回提供方的显示名。 */
export const testAiConnection = async (signal?: AbortSignal): Promise<string> => {
    const provider = requireProvider();
    const { value } = await generateJson<{ ok?: unknown }>({
        system: 'You are a connectivity check. Reply with the JSON object {"ok": true}.',
        user: 'ping',
        schemaName: 'connectivity_check',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
        maxOutputTokens: 1024,
        temperature: 0,
    }, provider, signal);
    if (value?.ok !== true) throw new AiRequestError(t('ai:errors.notJson'), 502);
    return PROVIDER_DISPLAY[provider.kind];
};
