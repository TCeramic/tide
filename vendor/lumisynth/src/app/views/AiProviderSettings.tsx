// src/app/views/AiProviderSettings.tsx
// 「AI」侧栏顶部：用户自己的 AI 提供方与密钥（浏览器直连，密钥只存在本机）。
import { useRef, useState } from 'react';
import { KeyRound, PlugZap } from 'lucide-react';
import { testAiConnection } from '@/ai/client';
import {
    AI_PROVIDER_LABELS,
    DEFAULT_MODELS,
    forgetAiKeys,
    patchAiConfig,
    setAiKey,
    setAiProvider,
    setRememberKeys,
    useAiSettings,
    type AiProviderKind,
    type AiSettings,
} from '@/ai/settings';
import { log } from '../output';
import { Button, Field, inputClass, Section, Toggle } from '../ui';
import { useTranslation } from 'react-i18next';

export function AiProviderSettings({ onChanged }: { onChanged?: () => void }) {
    const settings = useAiSettings();
    const { t } = useTranslation('ai');
    const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'busy'; text: string } | null>(null);
    const abort = useRef<AbortController | null>(null);
    const kind = settings.provider === 'none' ? null : settings.provider;
    const config = kind ? settings.configs[kind] : null;

    const test = async () => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setStatus({ kind: 'busy', text: t('provider.testing') });
        try {
            const name = await testAiConnection(controller.signal);
            setStatus({ kind: 'ok', text: t('provider.ok', { name }) });
            log(t('errorLog', { message: t('provider.ok', { name }) }));
        } catch (reason) {
            if (controller.signal.aborted) return;
            setStatus({ kind: 'error', text: (reason as Error).message });
        }
    };

    const changed = () => {
        setStatus(null);
        onChanged?.();
    };

    return (
        <Section title={t('provider.title')}>
            <select
                aria-label={t('provider.title')}
                value={settings.provider}
                onChange={event => {
                    setAiProvider(event.target.value as AiSettings['provider']);
                    changed();
                }}
                className={inputClass}
            >
                <option value="none">{t('provider.none')}</option>
                {(Object.keys(AI_PROVIDER_LABELS) as AiProviderKind[]).map(item => (
                    <option key={item} value={item}>{t(`providers.${item}`)}</option>
                ))}
            </select>
            {kind && config && (
                <>
                    <div className="text-[11px] text-zinc-500">{t(`provider.hints.${kind}`)}</div>
                    <Field label={t('provider.key')} hint={settings.rememberKeys ? t('provider.keyRemembered') : t('provider.keySession')}>
                        <input
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={kind === 'openai' ? t('provider.keyOptional') : ''}
                            value={settings.keys[kind] ?? ''}
                            onChange={event => {
                                setAiKey(kind, event.target.value);
                                changed();
                            }}
                            className={`${inputClass} select-text`}
                        />
                    </Field>
                    {kind !== 'gemini' && (
                        <Field label={kind === 'openai' ? t('provider.baseUrl') : t('provider.baseUrlOptional')}>
                            <input
                                type="url"
                                spellCheck={false}
                                placeholder={kind === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1/messages'}
                                value={config.baseUrl}
                                onChange={event => {
                                    patchAiConfig(kind, { baseUrl: event.target.value });
                                    changed();
                                }}
                                className={`${inputClass} select-text`}
                            />
                        </Field>
                    )}
                    <div className="grid grid-cols-[1fr_5rem] gap-2">
                        <Field label={t('provider.model')}>
                            <input
                                spellCheck={false}
                                placeholder={DEFAULT_MODELS[kind]}
                                value={config.model}
                                onChange={event => {
                                    patchAiConfig(kind, { model: event.target.value });
                                    changed();
                                }}
                                className={`${inputClass} select-text`}
                            />
                        </Field>
                        <Field label={t('provider.temperature')}>
                            <input
                                type="number"
                                min={0}
                                max={2}
                                step={0.1}
                                placeholder={t('provider.default')}
                                value={config.temperature ?? ''}
                                onChange={event => {
                                    const value = Number.parseFloat(event.target.value);
                                    patchAiConfig(kind, { temperature: Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : null });
                                    changed();
                                }}
                                className={`${inputClass} select-text`}
                            />
                        </Field>
                    </div>
                    <Toggle checked={settings.rememberKeys} onChange={setRememberKeys} label={t('provider.remember')} />
                    <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" onClick={() => void test()} disabled={status?.kind === 'busy'}>
                            <PlugZap size={12} /> {t('provider.test')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { forgetAiKeys(); changed(); }}>
                            <KeyRound size={12} /> {t('provider.forget')}
                        </Button>
                    </div>
                    {status && (
                        <div className={status.kind === 'error'
                            ? 'rounded-md bg-red-950/60 px-2 py-1.5 text-xs text-red-200 select-text'
                            : status.kind === 'ok' ? 'text-xs text-emerald-300' : 'text-xs text-zinc-400'}
                        >
                            {status.text}
                        </div>
                    )}
                </>
            )}
        </Section>
    );
}
