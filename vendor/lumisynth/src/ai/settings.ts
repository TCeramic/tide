// src/ai/settings.ts
// AI 提供方设置（用户自己的密钥，浏览器直连）。这是每个浏览器自己的偏好：不进工程文件、
// 不进 .lumi、不进撤销栈。密钥默认存 localStorage；勾掉「记住密钥」则只存 sessionStorage，
// 关掉标签页就忘。其余设置（类型、地址、模型、温度）总是存 localStorage。
import { create } from 'zustand';

export type AiProviderKind = 'gemini' | 'openai' | 'anthropic';

export interface AiProviderConfig {
    /** OpenAI 兼容接口的地址；可以只填 base URL（…/v1），会补上 chat/completions。 */
    baseUrl: string;
    /** 空串表示用默认模型。 */
    model: string;
    /** 空表示用各功能自己的默认温度。 */
    temperature: number | null;
}

export interface AiSettings {
    provider: AiProviderKind | 'none';
    configs: Record<AiProviderKind, AiProviderConfig>;
    rememberKeys: boolean;
}

interface AiSettingsState extends AiSettings {
    /** 按提供方分开存，切换提供方不丢。 */
    keys: Partial<Record<AiProviderKind, string>>;
}

export const AI_PROVIDER_LABELS: Record<AiProviderKind, string> = {
    gemini: 'Google Gemini',
    openai: 'OpenAI 兼容',
    anthropic: 'Anthropic Claude',
};

export const DEFAULT_MODELS: Record<AiProviderKind, string> = {
    gemini: 'gemini-3-flash-preview',
    openai: 'gpt-5.6-luna',
    anthropic: 'claude-sonnet-5',
};

const emptyConfig = (): AiProviderConfig => ({ baseUrl: '', model: '', temperature: null });

export const DEFAULT_AI_SETTINGS: AiSettings = {
    provider: 'none',
    configs: { gemini: emptyConfig(), openai: emptyConfig(), anthropic: emptyConfig() },
    rememberKeys: true,
};

const SETTINGS_KEY = 'lumisynth:ai';
const KEYS_KEY = 'lumisynth:ai-keys';

const storage = (kind: 'local' | 'session'): Storage | null => {
    try {
        return kind === 'local' ? window.localStorage : window.sessionStorage;
    } catch {
        return null;
    }
};

const readJson = <T>(store: Storage | null, key: string): T | null => {
    try {
        const raw = store?.getItem(key);
        return raw ? JSON.parse(raw) as T : null;
    } catch {
        return null;
    }
};

const writeJson = (store: Storage | null, key: string, value: unknown) => {
    try {
        if (value === null) store?.removeItem(key);
        else store?.setItem(key, JSON.stringify(value));
    } catch {
        // 隐私模式等：只在内存里有效。
    }
};

const normalizeSettings = (raw: Partial<AiSettings> | null): AiSettings => {
    const configs = { ...DEFAULT_AI_SETTINGS.configs };
    (Object.keys(configs) as AiProviderKind[]).forEach(kind => {
        configs[kind] = { ...emptyConfig(), ...raw?.configs?.[kind] };
    });
    const provider = raw?.provider && (raw.provider === 'none' || raw.provider in configs) ? raw.provider : 'none';
    return { provider, configs, rememberKeys: raw?.rememberKeys ?? true };
};

const load = (): AiSettingsState => {
    const settings = normalizeSettings(readJson<Partial<AiSettings>>(storage('local'), SETTINGS_KEY));
    const keys = readJson<AiSettingsState['keys']>(storage(settings.rememberKeys ? 'local' : 'session'), KEYS_KEY) ?? {};
    return { ...settings, keys };
};

export const useAiSettings = create<AiSettingsState>()(() => (typeof window === 'undefined'
    ? { ...DEFAULT_AI_SETTINGS, keys: {} }
    : load()));

const persist = (state: AiSettingsState) => {
    const { keys, ...settings } = state;
    writeJson(storage('local'), SETTINGS_KEY, settings);
    const hasKeys = Object.values(keys).some(Boolean);
    writeJson(storage(state.rememberKeys ? 'local' : 'session'), KEYS_KEY, hasKeys ? keys : null);
    // 换了存放位置：另一边的旧副本要清掉。
    writeJson(storage(state.rememberKeys ? 'session' : 'local'), KEYS_KEY, null);
};

export const setAiProvider = (provider: AiSettings['provider']) => {
    useAiSettings.setState({ provider });
    persist(useAiSettings.getState());
};

export const patchAiConfig = (kind: AiProviderKind, patch: Partial<AiProviderConfig>) => {
    const state = useAiSettings.getState();
    useAiSettings.setState({ configs: { ...state.configs, [kind]: { ...state.configs[kind], ...patch } } });
    persist(useAiSettings.getState());
};

export const setAiKey = (kind: AiProviderKind, key: string) => {
    const state = useAiSettings.getState();
    useAiSettings.setState({ keys: { ...state.keys, [kind]: key.trim() || undefined } });
    persist(useAiSettings.getState());
};

export const setRememberKeys = (rememberKeys: boolean) => {
    useAiSettings.setState({ rememberKeys });
    persist(useAiSettings.getState());
};

export const forgetAiKeys = () => {
    useAiSettings.setState({ keys: {} });
    persist(useAiSettings.getState());
};

/** 当前生效的提供方与凭据；没选或没填密钥时为 null。 */
export interface ResolvedAiProvider {
    kind: AiProviderKind;
    apiKey: string;
    config: AiProviderConfig;
}

export const resolveAiProvider = (state: AiSettingsState = useAiSettings.getState()): ResolvedAiProvider | null => {
    if (state.provider === 'none') return null;
    const apiKey = state.keys[state.provider];
    // OpenAI 兼容的本地服务（Ollama、LM Studio）可以不要密钥，但得填地址。
    if (!apiKey && !(state.provider === 'openai' && state.configs.openai.baseUrl.trim())) return null;
    return { kind: state.provider, apiKey: apiKey ?? '', config: state.configs[state.provider] };
};
