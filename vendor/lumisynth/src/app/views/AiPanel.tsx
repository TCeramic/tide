// src/app/views/AiPanel.tsx
// 主侧栏「AI」：主题配色、分词、场景编排。结果直接写进工程，可以撤销；
// 场景编排不会覆盖用户手动设置过的段落与转场。
// 连上 agent（MCP 桥）后三个按钮改为「复制指令」：用户粘贴给 agent，由它取同样的提示词、生成并写回，不需要 AI 密钥。
import { useEffect, useRef, useState } from 'react';
import { Bot, Check, Copy, Palette, Scissors, Sparkles, Trash2 } from 'lucide-react';
import { useAgentBridge } from '@/agent/bridgeClient';
import { agentTaskInstruction, type AgentTask } from '@/agent/tools';
import { applySceneDirection, clearSceneDirection, generateAiSegmentation, generateAiTheme, generateSceneDirection } from '@/ai/actions';
import { resolveAiProvider, useAiSettings } from '@/ai/settings';
import { useSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import type { SceneDirectionResponse } from '@/ai/sceneDirection';
import { useProgram } from '../DerivedProvider';
import { log } from '../output';
import { useTranslation } from 'react-i18next';
import { packShortLabel, paragraphKindLabel } from '@/i18n/catalog';
import { Button, Section, Toggle } from '../ui';
import { AiProviderSettings } from './AiProviderSettings';

type Task = 'theme' | 'segment' | 'direct';

const AGENT_TASKS: Record<Task, AgentTask> = { theme: 'theme', segment: 'segmentation', direct: 'scene_direction' };

export function AiPanel() {
    const program = useProgram();
    const project = useProjectStore(state => state.project);
    const analysis = useSession(state => state.analysis);
    const provider = useAiSettings(state => resolveAiProvider(state)?.kind ?? null);
    const [busy, setBusy] = useState<Task | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [keepManual, setKeepManual] = useState(true);
    const [direction, setDirection] = useState<(SceneDirectionResponse & { provider?: string }) | null>(null);
    const abort = useRef<AbortController | null>(null);
    const bridged = useAgentBridge(state => state.status === 'connected');
    const [copied, setCopied] = useState<Task | null>(null);
    const copiedTimer = useRef<number | undefined>(undefined);
    const { t } = useTranslation(['ai', 'common']);

    useEffect(() => () => {
        abort.current?.abort();
        window.clearTimeout(copiedTimer.current);
    }, []);

    const copyInstruction = (task: Task) => {
        const instruction = agentTaskInstruction(AGENT_TASKS[task], { skipManual: keepManual });
        setError(null);
        void navigator.clipboard.writeText(instruction).then(() => {
            setCopied(task);
            log(t('copiedLog', { instruction }));
            window.clearTimeout(copiedTimer.current);
            copiedTimer.current = window.setTimeout(() => setCopied(null), 2000);
        }, () => setError(t('copyFailed')));
    };

    /** 连上 agent 时替换原来的生成按钮。 */
    const copyButton = (task: Task, disabled: boolean, variant?: 'primary') => (
        <Button className="w-full" variant={variant} disabled={disabled} onClick={() => copyInstruction(task)}>
            {copied === task ? <Check size={14} /> : <Copy size={14} />} {copied === task ? t('copied') : t('copy')}
        </Button>
    );

    const run = async (task: Task, work: (signal: AbortSignal) => Promise<string>) => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setBusy(task);
        setError(null);
        try {
            log(await work(controller.signal));
        } catch (reason) {
            if (controller.signal.aborted) return;
            const message = (reason as Error).message;
            setError(message);
            log(t('errorLog', { message }), 'error');
        } finally {
            if (abort.current === controller) setBusy(null);
        }
    };

    const aiDirected = project.paragraphDirections.filter(item => item.source === 'ai').length;
    const available = provider !== null;
    const current = project.theme.dual[project.theme.variant];

    return (
        <>
            {bridged && (
                <div className="mx-4 mt-3 mb-1 flex gap-2 rounded-md border border-sky-800/60 bg-sky-950/40 px-2.5 py-2 text-xs text-sky-100">
                    <Bot size={14} className="mt-0.5 shrink-0 text-sky-300" />
                    <div>{t('bridged')}</div>
                </div>
            )}
            <AiProviderSettings />
            {!bridged && (
                <div className="px-4 pt-1 pb-1 text-xs text-zinc-400">
                    {provider === null
                        ? t('noProvider')
                        : t('usingProvider', { provider: t(`providers.${provider}`) })}
                </div>
            )}
            {error && <div className="mx-4 my-2 rounded-md bg-red-950/60 px-2 py-1.5 text-xs text-red-200">{error}</div>}

            <Section title={t('theme.title')}>
                <div className="text-[11px] text-zinc-500">{t('theme.hint')}</div>
                <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                        {[current.backgroundColor, current.primaryColor, current.accentColor, current.secondaryColor].map((color, index) => (
                            <span key={index} className="h-5 w-5 rounded-sm ring-1 ring-zinc-700" style={{ backgroundColor: color }} />
                        ))}
                    </div>
                    <span className="truncate text-xs text-zinc-300">{current.name}</span>
                </div>
                {project.theme.source === 'ai' && current.description && <div className="text-xs text-zinc-400">{t('common:quoted', { text: current.description })}</div>}
                {bridged ? copyButton('theme', false) : <Button
                    className="w-full"
                    disabled={!available || busy !== null}
                    onClick={() => void run('theme', async signal => {
                        const dual = await generateAiTheme(program, project, signal);
                        return t('theme.done', { dark: dual.dark.name, light: dual.light.name });
                    })}
                >
                    <Palette size={14} /> {busy === 'theme' ? t('theme.busy') : t('theme.run')}
                </Button>}
            </Section>

            <Section title={t('segment.title')}>
                <div className="text-[11px] text-zinc-500">{t('segment.hint')}</div>
                <Toggle label={t('segment.keepManual')} checked={keepManual} onChange={setKeepManual} />
                {bridged ? copyButton('segment', program.lines.length === 0) : <Button
                    className="w-full"
                    disabled={!available || busy !== null || program.lines.length === 0}
                    onClick={() => void run('segment', async signal => {
                        const count = await generateAiSegmentation(program, { keepManual }, project, signal);
                        return t('segment.done', { count });
                    })}
                >
                    <Scissors size={14} /> {busy === 'segment' ? t('segment.busy') : t('segment.run')}
                </Button>}
            </Section>

            <Section
                title={t('direct.title')}
                actions={aiDirected > 0 ? (
                    <button type="button" onClick={() => { clearSceneDirection(); setDirection(null); }} className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-200">
                        <Trash2 size={12} /> {t('direct.clear')}
                    </button>
                ) : undefined}
            >
                <div className="text-[11px] text-zinc-500">{t('direct.hint')}</div>
                {bridged ? copyButton('direct', program.paragraphs.length === 0, 'primary') : <Button
                    className="w-full"
                    variant="primary"
                    disabled={!available || busy !== null || program.paragraphs.length === 0}
                    onClick={() => void run('direct', async signal => {
                        const result = await generateSceneDirection(program, project, analysis, signal);
                        setDirection(result);
                        return t('direct.done', { count: result.paragraphs.length, summary: result.summary });
                    })}
                >
                    <Sparkles size={14} /> {busy === 'direct' ? t('direct.busy') : t('direct.run')}
                </Button>}
                {direction && (
                    <div className="space-y-1.5">
                        {direction.summary && <div className="text-xs text-zinc-300">{direction.summary}</div>}
                        <ul className="space-y-1 text-[11px]">
                            {direction.paragraphs.map(item => {
                                const paragraph = program.paragraphs.find(p => p.index === item.index);
                                return (
                                    <li key={item.index} className="flex items-baseline gap-1.5">
                                        <span className="w-16 shrink-0 text-zinc-500">#{item.index + 1} {paragraph ? paragraphKindLabel(paragraph.kind) : ''}</span>
                                        <span className="shrink-0 text-zinc-200">{packShortLabel(item.pack)}</span>
                                        <span className="shrink-0 text-zinc-500 tabular-nums">{item.energy.toFixed(2)}</span>
                                        <span className="truncate text-zinc-400">{item.reason}</span>
                                    </li>
                                );
                            })}
                        </ul>
                        <Button size="sm" variant="ghost" onClick={() => applySceneDirection(program, direction)}>{t('direct.reapply')}</Button>
                    </div>
                )}
            </Section>
        </>
    );
}
