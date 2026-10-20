// src/app/views/AgentPanel.tsx
// 主侧栏「Agent」：把用户自己的 agent（Claude Code 等支持 MCP 的工具）接到这个页面。
// 连接走本地桥 bridge/lumisynth-mcp.mjs：agent 启动它，页面填端口与配对码连上。
import { useState } from 'react';
import { Copy, Download, Plug, Unplug } from 'lucide-react';
import {
    connectAgentBridge,
    DEFAULT_BRIDGE_PORT,
    disconnectAgentBridge,
    useAgentBridge,
} from '@/agent/bridgeClient';
import { skillArchive, SKILL_ARCHIVE_NAME } from '@/agent/skill';
import { AGENT_PROMPTS, AGENT_TOOLS } from '@/agent/tools';
import { downloadBlob } from '../download';
import { log } from '../output';
import { Button, cx, Field, inputClass, Section } from '../ui';
import { Trans, useTranslation } from 'react-i18next';

const BRIDGE_FILE = 'lumisynth-mcp.mjs';

export function AgentPanel() {
    const { status, port, error, activity } = useAgentBridge();
    const { t } = useTranslation('ai');
    const setupCommand = `claude mcp add lumisynth -- node ${t('agent.downloadDir')}/${BRIDGE_FILE}`;
    const [portDraft, setPortDraft] = useState(String(port || DEFAULT_BRIDGE_PORT));
    const [code, setCode] = useState('');
    const busy = status === 'connecting';

    const connect = () => {
        const value = Number.parseInt(portDraft, 10);
        void connectAgentBridge(Number.isFinite(value) ? value : DEFAULT_BRIDGE_PORT, code).then(() => setCode(''));
    };

    const copy = (text: string) => {
        void navigator.clipboard?.writeText(text).then(() => log(t('agent.copied')));
    };

    return (
        <>
            <Section title={t('agent.connection')}>
                <div className="flex items-center gap-2 text-xs">
                    <span className={cx('h-2 w-2 rounded-full', status === 'connected' ? 'bg-emerald-400' : status === 'error' ? 'bg-red-400' : busy ? 'bg-amber-400' : 'bg-zinc-600')} />
                    <span className="text-zinc-300">{t(`agent.status.${status}`)}</span>
                    {status === 'connected' && <span className="text-zinc-500">127.0.0.1:{port}</span>}
                </div>
                {status === 'connected' ? (
                    <>
                        <div className="text-[11px] text-zinc-500">{t('agent.connectedHint')}</div>
                        <Button size="sm" onClick={disconnectAgentBridge}><Unplug size={12} /> {t('agent.disconnect')}</Button>
                    </>
                ) : (
                    <>
                        <div className="grid grid-cols-[5.5rem_1fr] gap-2">
                            <Field label={t('agent.port')}>
                                <input
                                    inputMode="numeric"
                                    value={portDraft}
                                    onChange={event => setPortDraft(event.target.value)}
                                    className={`${inputClass} select-text`}
                                />
                            </Field>
                            <Field label={t('agent.code')}>
                                <input
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder={t('agent.codePlaceholder')}
                                    value={code}
                                    onChange={event => setCode(event.target.value.toUpperCase())}
                                    onKeyDown={event => { if (event.key === 'Enter' && code.trim()) connect(); }}
                                    className={`${inputClass} select-text font-mono tracking-widest`}
                                />
                            </Field>
                        </div>
                        <Button size="sm" variant="primary" disabled={busy || !code.trim()} onClick={connect}><Plug size={12} /> {t('agent.connect')}</Button>
                        {error && <div className="rounded-md bg-red-950/60 px-2 py-1.5 text-xs text-red-200 select-text">{error}</div>}
                    </>
                )}
            </Section>

            {status !== 'connected' && (
                <Section title={t('agent.firstTime')}>
                    <ol className="list-decimal space-y-1.5 pl-4 text-[11px] text-zinc-400">
                        <li>
                            <Trans
                                t={t}
                                i18nKey="agent.step1"
                                values={{ file: BRIDGE_FILE }}
                                components={{ dl: <a href={`${import.meta.env.BASE_URL}${BRIDGE_FILE}`} download={BRIDGE_FILE} className="text-amber-300 underline" /> }}
                            />
                        </li>
                        <li>
                            {t('agent.step2')}
                            <div className="mt-1 flex items-center gap-1">
                                <code className="min-w-0 flex-1 truncate rounded bg-zinc-800 px-1.5 py-1 text-[10px] text-zinc-200 select-text">{setupCommand}</code>
                                <button type="button" aria-label={t('agent.copyCommand')} onClick={() => copy(setupCommand)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"><Copy size={12} /></button>
                            </div>
                        </li>
                        <li><Trans t={t} i18nKey="agent.step3" components={{ code: <code className="select-text" /> }} /></li>
                        <li>{t('agent.step4')}</li>
                    </ol>
                    <div className="text-[11px] text-zinc-500">
                        {t('agent.afterConnect', { buttons: AGENT_PROMPTS.map(prompt => prompt.title).join(t('agent.listSeparator')) })}
                    </div>
                </Section>
            )}

            <Section title={t('agent.skill')}>
                <div className="text-[11px] text-zinc-400">
                    <Trans t={t} i18nKey="agent.skillHint" components={{ code: <code className="select-text" /> }} />
                </div>
                <Button size="sm" onClick={() => downloadBlob(skillArchive(), SKILL_ARCHIVE_NAME)}><Download size={12} /> {t('agent.download', { file: SKILL_ARCHIVE_NAME })}</Button>
            </Section>

            <Section title={t('agent.tools', { count: AGENT_TOOLS.length })}>
                <ul className="space-y-0.5 text-[11px]">
                    {AGENT_TOOLS.map(tool => (
                        <li key={tool.name} className="flex gap-2" title={tool.description}>
                            <code className="text-zinc-300">{tool.name}</code>
                            <span className="truncate text-zinc-500">{tool.title}{tool.readOnly ? '' : ` · ${t('agent.writes')}`}</span>
                        </li>
                    ))}
                </ul>
            </Section>

            {activity.length > 0 && (
                <Section title={t('agent.activity')}>
                    <ul className="space-y-1 text-[11px]">
                        {activity.slice(0, 20).map(entry => (
                            <li key={`${entry.at}-${entry.tool}`} className={entry.ok ? 'text-zinc-300' : 'text-red-300'}>
                                <span className="text-zinc-500">{new Date(entry.at).toLocaleTimeString()}</span> {entry.tool} · {entry.summary}
                            </li>
                        ))}
                    </ul>
                </Section>
            )}
        </>
    );
}
