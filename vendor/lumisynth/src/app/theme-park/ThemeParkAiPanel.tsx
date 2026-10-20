// src/app/theme-park/ThemeParkAiPanel.tsx
// 「AI」页：用已配置的 AI 直接生成到草稿；或者手动往返——复制提示词到别的 AI 工具、把它的 JSON 贴回来、
// 复制当前草稿的 JSON。生成与导入的结果都只进草稿，在预览里看过、改过再应用。
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Sparkles } from 'lucide-react';
import type { DualTheme } from '@/core/types';
import { requestTheme } from '@/ai/client';
import { resolveAiProvider, useAiSettings } from '@/ai/settings';
import { buildThemeSourcePrompt, parseAiThemeJsonInput, THEME_GENERATION_PROMPT_PREFIX } from '@/ai/themePrompt';
import { useProjectStore } from '@/project/store';
import { useProgram } from '../DerivedProvider';
import { log } from '../output';
import { Button } from '../ui';
import { useTranslation } from 'react-i18next';

const isLyricLine = (text: string) => text.trim().length > 0 && text !== '......' && text !== '♪';

/** 与「AI → 主题配色」相同的输入：全部歌词；纯音乐时用歌名。 */
const useThemeSource = () => {
    const program = useProgram();
    const title = useProjectStore(state => state.project.meta.title || state.project.name);
    const lines = program.lines.map(line => line.line.fullText).filter(isLyricLine);
    const isPureMusic = lines.length === 0;
    return { text: isPureMusic ? title : lines.join('\n'), isPureMusic, title };
};

const useCopied = () => {
    const [copied, setCopied] = useState(false);
    const timer = useRef<number>(0);
    useEffect(() => () => window.clearTimeout(timer.current), []);
    return [copied, () => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 2000);
    }] as const;
};

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2.5 rounded-md border border-zinc-800 p-3">
            <div>
                <div className="text-sm text-zinc-100">{title}</div>
                {hint && <div className="text-[11px] text-zinc-500">{hint}</div>}
            </div>
            {children}
        </div>
    );
}

export function ThemeParkAiPanel({ buildTheme, onImport }: { buildTheme: () => DualTheme; onImport: (theme: DualTheme) => void }) {
    const source = useThemeSource();
    const available = useAiSettings(state => resolveAiProvider(state) !== null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [json, setJson] = useState('');
    const [importError, setImportError] = useState<string | null>(null);
    const [promptCopied, markPromptCopied] = useCopied();
    const [jsonCopied, markJsonCopied] = useCopied();
    const abort = useRef<AbortController | null>(null);
    const { t } = useTranslation('theme');
    useEffect(() => () => abort.current?.abort(), []);

    const generate = async () => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setBusy(true);
        setError(null);
        try {
            const dual = await requestTheme(source.text, source.isPureMusic, source.title, controller.signal);
            onImport(dual);
            log(t('ai.generated', { dark: dual.dark.name, light: dual.light.name }));
        } catch (reason) {
            if (!controller.signal.aborted) setError((reason as Error).message);
        } finally {
            if (abort.current === controller) setBusy(false);
        }
    };

    const copy = async (text: string, done: () => void) => {
        try {
            await navigator.clipboard.writeText(text);
            done();
        } catch (reason) {
            log(t('ai.copyFailed', { message: (reason as Error).message }), 'error');
        }
    };

    const importJson = () => {
        setImportError(null);
        if (!json.trim()) return;
        try {
            onImport(parseAiThemeJsonInput(json) as DualTheme);
            setJson('');
        } catch {
            setImportError(t('ai.invalidJson'));
        }
    };

    return (
        <div className="space-y-4">
            <Card title={t('ai.generate')} hint={available ? t('ai.generateHint') : t('ai.noProvider')}>
                <Button variant="primary" className="w-full" disabled={!available || busy} onClick={() => void generate()}>
                    <Sparkles size={14} /> {busy ? t('ai.busy') : t('ai.run')}
                </Button>
                {error && <div className="text-xs text-red-400">{error}</div>}
            </Card>

            <Card title={t('ai.copyPrompt')} hint={t('ai.copyPromptHint')}>
                <Button className="w-full" onClick={() => void copy(`${THEME_GENERATION_PROMPT_PREFIX}\n\n${buildThemeSourcePrompt(source.text, source.isPureMusic, source.title)}`, markPromptCopied)}>
                    {promptCopied ? <Check size={14} /> : <Copy size={14} />} {promptCopied ? t('ai.copied') : t('ai.copyPrompt')}
                </Button>
            </Card>

            <Card title={t('ai.import')} hint={t('ai.importHint')}>
                <textarea
                    aria-label={t('ai.json')}
                    value={json}
                    rows={6}
                    placeholder={t('ai.jsonPlaceholder')}
                    onChange={event => {
                        setJson(event.target.value);
                        setImportError(null);
                    }}
                    spellCheck={false}
                    className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-100 outline-none select-text focus:border-amber-400/70"
                />
                {importError && <div className="text-xs text-red-400">{importError}</div>}
                <Button className="w-full" disabled={!json.trim()} onClick={importJson}>
                    <Download size={14} /> {t('ai.importButton')}
                </Button>
            </Card>

            <Card title={t('ai.export')}>
                <Button className="w-full" onClick={() => void copy(JSON.stringify(buildTheme(), null, 2), markJsonCopied)}>
                    {jsonCopied ? <Check size={14} /> : <Copy size={14} />} {jsonCopied ? t('ai.copied') : t('ai.copyJson')}
                </Button>
            </Card>
        </div>
    );
}
