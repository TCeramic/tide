// src/app/ScriptView.tsx
// 编辑区「剧本」标签页，三个视图：
//   剧本：场景编排（LumiScript v2），可以直接改、手写、导入，Ctrl+S 应用（一步撤销）；
//   设置：其余工程设置（主题、字体、画幅、tuning……）的 JSON sidecar，同样可以改、导入、应用；
//   JSON：编译出来的原始编排（只读）。
// 没改过时跟着工程自动刷新；改过而工程又在别处变了，提示「已过期」，可以重新载入或仍然应用。
// 剧本里点一行选中对应的段落 / 镜头 / 片段；选区与播放头所在的镜头会标出来。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, Play, RotateCcw, Upload } from 'lucide-react';
import { closeBrackets } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { lintKeymap, setDiagnostics } from '@codemirror/lint';
import { EditorState, Prec, RangeSetBuilder, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { commitScript, commitSettings } from '@/script/actions';
import type { ScriptEnv } from '@/script/apply';
import { formatDiagnostic, type Diagnostic } from '@/script/diagnostics';
import { scriptEnv } from '@/script/env';
import { printScript, programToJson, type ScriptLine } from '@/script/print';
import { printSettings } from '@/script/settings';
import { setSession, useSession } from '@/project/session';
import { getProject, useProjectStore } from '@/project/store';
import { resolveClipRange, type ClipTiming } from '@/core/assets/clips';
import { selectParagraph, selectShot, usePlayheadLocation } from './arrangeActions';
import { useProgram } from './DerivedProvider';
import { downloadBlob } from './download';
import { log } from './output';
import { seek } from './playback';
import { revealInTimeline } from './timeline/reveal';
import { lumiscript, scriptTheme, settingsLanguage, toCmDiagnostics } from './script/lumiscript';
import { onScriptImport } from './script/scriptImport';
import { Button, cx, Segmented, Toggle } from './ui';
import { useTranslation } from 'react-i18next';

type Mode = 'script' | 'settings' | 'json';

// 选中的行与播放头所在的行（行号 1 起）。
const setMarks = StateEffect.define<{ selected: number[]; playing: number | null }>();
const selectedLine = Decoration.line({ class: 'cm-script-selected' });
const playingLine = Decoration.line({ class: 'cm-script-playing' });

const marksField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, transaction) {
        let next = value.map(transaction.changes);
        for (const effect of transaction.effects) {
            if (!effect.is(setMarks)) continue;
            const { doc } = transaction.state;
            const lines = new Map<number, Decoration[]>();
            effect.value.selected.forEach(n => lines.set(n, [selectedLine]));
            if (effect.value.playing) lines.set(effect.value.playing, [...(lines.get(effect.value.playing) ?? []), playingLine]);
            const builder = new RangeSetBuilder<Decoration>();
            [...lines.keys()].filter(n => n >= 1 && n <= doc.lines).sort((a, b) => a - b).forEach(n => {
                const from = doc.line(n).from;
                lines.get(n)!.forEach(decoration => builder.add(from, from, decoration));
            });
            next = builder.finish();
        }
        return next;
    },
    provide: field => EditorView.decorations.from(field),
});

const summarize = (diagnostics: Diagnostic[]) => {
    const errors = diagnostics.filter(item => item.severity === 'error');
    const warnings = diagnostics.filter(item => item.severity === 'warning');
    return { errors, warnings };
};

export function ScriptView() {
    const program = useProgram();
    const project = useProjectStore(state => state.project);
    const duration = useSession(state => state.audioBuffer?.duration ?? null);
    const projectName = project.meta.title || project.name;
    const selection = useSession(state => state.selection);
    const location = usePlayheadLocation(program);
    const [mode, setMode] = useState<Mode>('script');
    const { t } = useTranslation(['script', 'common']);
    const [includeNative, setIncludeNative] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [base, setBase] = useState('');
    const [confirmStale, setConfirmStale] = useState(false);
    const host = useRef<HTMLDivElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const view = useRef<EditorView | null>(null);
    const baseRef = useRef('');
    const reloadNext = useRef(false);
    const pendingImport = useRef<string | null>(null);

    // 剧本自己编一份编排（界面上的编排可能带着「试看」的临时修改）。
    const env = useMemo(() => (mode === 'script' ? scriptEnv(project, duration) : null), [mode, project, duration]);
    const envRef = useRef<ScriptEnv | null>(env);
    envRef.current = env;
    const projectRef = useRef(project);
    projectRef.current = project;
    const generated = useMemo(() => {
        if (mode === 'script' && env) return printScript(env);
        if (mode === 'settings') {
            const text = printSettings(project);
            return { text, lines: [] as ScriptLine[] };
        }
        return { text: '', lines: [] as ScriptLine[] };
    }, [mode, env, project]);
    const generatedRef = useRef(generated);
    generatedRef.current = generated;
    const stale = dirty && generated.text !== base;
    // 句首用 label，句中用 name（英文要小写）。
    const label = mode === 'settings' ? t('labels.settings') : t('labels.script');
    const name = mode === 'settings' ? t('names.settings') : t('names.script');

    const load = (text: string) => {
        const editor = view.current;
        baseRef.current = text;
        setBase(text);
        setDirty(false);
        setConfirmStale(false);
        if (!editor) return;
        // 载入不进编辑器自己的撤销历史（Ctrl+Z 不会把剧本退回到应用前的文字）。
        if (editor.state.doc.toString() !== text) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text }, annotations: Transaction.addToHistory.of(false) });
    };

    const apply = (force = false) => {
        const editor = view.current;
        if (!editor) return;
        const edited = editor.state.doc.toString();
        if (!force && generatedRef.current.text !== baseRef.current) {
            setConfirmStale(true);
            return;
        }
        const latest = getProject();
        const result = mode === 'settings' ? commitSettings(edited, latest) : commitScript(edited, scriptEnv(latest, duration));
        editor.dispatch(setDiagnostics(editor.state, toCmDiagnostics(editor.state.doc, result.diagnostics)));
        const { errors, warnings } = summarize(result.diagnostics);
        if (!result.ok) {
            log(`${t('notApplied', { label, count: errors.length })}\n${errors.slice(0, 5).map(formatDiagnostic).join('\n')}`, 'warn');
            return;
        }
        setConfirmStale(false);
        if (result.changes.length === 0) {
            log(warnings.length ? t('unchangedWithHints', { label, count: warnings.length }) : t('unchanged', { label }));
            return;
        }
        const changes = result.changes.join(t('changeSeparator'));
        log(warnings.length ? t('appliedWithHints', { label, changes, count: warnings.length }) : t('applied', { label, changes }));
        reloadNext.current = true;
    };
    const applyRef = useRef(apply);
    applyRef.current = apply;

    const pick = (lineNumber: number) => {
        if (mode !== 'script' || baseRef.current !== view.current?.state.doc.toString()) return;
        const line: ScriptLine | undefined = generatedRef.current.lines[lineNumber - 1];
        if (!line) return;
        const current = envRef.current?.program ?? program;
        const latest = projectRef.current;
        // 片段按它在编排里的时间范围在时间轴上显示（全曲的片段截到最后一段结束）。
        const songEnd = current.paragraphs.at(-1)?.endTime ?? 0;
        const revealClip = (timing: ClipTiming, lead = 0, tail = 0) => {
            const range = resolveClipRange(timing, current);
            if (range) revealInTimeline(Math.max(0, range.start - lead), Math.min(songEnd, range.end) + tail);
        };
        if (line.clipId) {
            setSession({ selection: { type: 'clip', clipId: line.clipId } });
            const clip = latest.assetClips.find(item => item.id === line.clipId);
            if (clip) revealClip(clip.timing, clip.lead, clip.tail);
            return;
        }
        if (line.backgroundId) {
            setSession({ selection: { type: 'background', clipId: line.backgroundId } });
            const clip = latest.backgroundClips.find(item => item.id === line.backgroundId);
            if (clip) revealClip(clip.timing);
            return;
        }
        if (line.lineIndex !== undefined) {
            setSession({ selection: { type: 'line', lineIndex: line.lineIndex } });
            const lyric = current.lines[line.lineIndex];
            if (lyric) {
                seek(lyric.line.startTime + 0.01);
                revealInTimeline(lyric.line.startTime, lyric.renderEndTime);
            }
            return;
        }
        const paragraph = current.paragraphs.find(item => item.id === line.paragraphId);
        if (!paragraph) return;
        const shot = line.shotId ? paragraph.shots.find(item => item.id === line.shotId) : undefined;
        if (shot) selectShot(paragraph, shot);
        else selectParagraph(paragraph);
    };
    const pickRef = useRef(pick);
    pickRef.current = pick;

    // 编辑器按视图建（JSON 视图不用编辑器）。
    useEffect(() => {
        if (!host.current || mode === 'json') return;
        const language = mode === 'script'
            ? lumiscript(() => envRef.current ?? scriptEnv(projectRef.current, duration))
            : settingsLanguage(() => projectRef.current);
        const editor = new EditorView({
            parent: host.current,
            state: EditorState.create({
                doc: generatedRef.current.text,
                extensions: [
                    lineNumbers(),
                    highlightActiveLine(),
                    highlightActiveLineGutter(),
                    history(),
                    closeBrackets(),
                    Prec.highest(keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { applyRef.current(); return true; } }])),
                    keymap.of([...defaultKeymap, ...historyKeymap, ...lintKeymap, indentWithTab]),
                    EditorState.tabSize.of(2),
                    scriptTheme,
                    language,
                    marksField,
                    EditorView.updateListener.of(update => {
                        if (update.docChanged) setDirty(update.state.doc.toString() !== baseRef.current);
                        if (update.selectionSet && update.transactions.some(tr => tr.isUserEvent('select.pointer'))) {
                            pickRef.current(update.state.doc.lineAt(update.state.selection.main.head).number);
                        }
                    }),
                ],
            }),
        });
        view.current = editor;
        baseRef.current = generatedRef.current.text;
        setBase(generatedRef.current.text);
        setDirty(false);
        setConfirmStale(false);
        // 导入的文件：换到对应视图后放进编辑器（改动，等应用）。
        if (pendingImport.current !== null) {
            editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: pendingImport.current } });
            pendingImport.current = null;
        }
        return () => {
            editor.destroy();
            view.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]);

    // 工程变了：没改过（或刚应用完）就换成新的内容。
    useEffect(() => {
        if (!view.current) return;
        if (reloadNext.current || view.current.state.doc.toString() === baseRef.current) {
            reloadNext.current = false;
            load(generated.text);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [generated]);

    // 选区与播放头的标记（只在剧本视图、没改过时对得上行号）。
    const selectedShot = selection.type === 'shot' ? selection.shotId : null;
    const selectedParagraph = selection.type === 'paragraph' ? selection.paragraphId : null;
    const selectedClip = selection.type === 'clip' || selection.type === 'background' ? selection.clipId : null;
    useEffect(() => {
        const editor = view.current;
        if (!editor || mode !== 'script') return;
        const matches = (line: ScriptLine) => (selectedShot ? line.shotId === selectedShot
            : selectedClip ? line.clipId === selectedClip || line.backgroundId === selectedClip
                : Boolean(selectedParagraph && line.paragraphId === selectedParagraph && !line.shotId && line.lineIndex === undefined));
        const aligned = !dirty;
        const selected = aligned ? generated.lines.flatMap((line, index) => (matches(line) ? [index + 1] : [])) : [];
        const playingIndex = aligned ? generated.lines.findIndex(line => line.shotId === location.shotId && /^\s*shot /.test(line.text)) : -1;
        editor.dispatch({ effects: setMarks.of({ selected, playing: playingIndex >= 0 ? playingIndex + 1 : null }) });
        if (selected.length > 0 && !editor.hasFocus) {
            editor.dispatch({ effects: EditorView.scrollIntoView(editor.state.doc.line(selected[0]).from, { y: 'nearest' }) });
        }
    }, [mode, generated, selectedShot, selectedParagraph, selectedClip, location.shotId, dirty]);

    const importFile = async (file: File) => {
        const text = await file.text();
        const asSettings = /\.json$/i.test(file.name) || text.trimStart().startsWith('{');
        const target: Mode = asSettings ? 'settings' : 'script';
        log(t('imported', { file: file.name, target: asSettings ? t('labels.settings') : t('labels.script') }));
        if (target === mode && view.current) {
            view.current.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: text } });
            return;
        }
        pendingImport.current = text;
        setMode(target);
    };

    const importRef = useRef(importFile);
    importRef.current = importFile;
    // 「文件 › 导入剧本或设置…」选好的文件。
    useEffect(() => onScriptImport(file => void importRef.current(file)), []);

    const json = useMemo(() => (mode === 'json' ? programToJson(program, includeNative) : ''), [program, mode, includeNative]);
    const content = () => (mode === 'json' ? json : view.current?.state.doc.toString() ?? generated.text);
    const safeName = projectName.replace(/[\\/:*?"<>|]+/g, '_') || 'lumisynth';
    const fileName = `${safeName}.${mode === 'script' ? 'lumiscript' : mode === 'settings' ? 'settings.json' : 'program.json'}`;

    return (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="script-view">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5 select-none">
                <Segmented<Mode>
                    value={mode}
                    onChange={setMode}
                    options={[{ value: 'script', label: t('labels.script') }, { value: 'settings', label: t('labels.settings') }, { value: 'json', label: 'JSON' }]}
                />
                {mode !== 'json' && (
                    <>
                        <Button size="sm" onClick={() => apply()} disabled={!dirty} title={t('applyHint', { name })}>
                            <Play size={12} /> {t('apply')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => load(generated.text)} disabled={!dirty && !stale} title={t('reloadHint', { name })}>
                            <RotateCcw size={12} /> {t('reload')}
                        </Button>
                        {dirty && <span className={cx('text-xs', stale ? 'text-amber-300' : 'text-zinc-400')}>{stale ? t('dirtyStale', { label }) : t('dirty')}</span>}
                    </>
                )}
                {mode === 'json' && <div className="w-44"><Toggle checked={includeNative} onChange={setIncludeNative} label={t('includeNative')} /></div>}
                <div className="flex-1" />
                <Button size="sm" variant="ghost" title={t('importHint')} aria-label={t('import')} onClick={() => fileInput.current?.click()}>
                    <Upload size={12} />
                </Button>
                <input
                    ref={fileInput}
                    type="file"
                    accept=".lumiscript,.txt,.json,text/plain,application/json"
                    className="hidden"
                    data-testid="script-import"
                    onChange={event => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) void importFile(file);
                    }}
                />
                <Button size="sm" variant="ghost" title={t('copy')} aria-label={t('copy')} onClick={() => void navigator.clipboard?.writeText(content()).then(() => log(t('copied')))}>
                    <Copy size={12} />
                </Button>
                <Button size="sm" variant="ghost" title={t('download')} aria-label={t('download')} onClick={() => downloadBlob(new Blob([content()], { type: 'text/plain;charset=utf-8' }), fileName)}>
                    <Download size={12} />
                </Button>
            </div>
            {mode !== 'json' && confirmStale && (
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-900/60 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-200 select-none" role="alert">
                    <span>{t('staleWarning', { name })}</span>
                    <div className="flex-1" />
                    <Button size="sm" onClick={() => apply(true)}>{t('applyAnyway')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => load(generated.text)}>{t('reload')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmStale(false)}>{t('common:cancel')}</Button>
                </div>
            )}
            {mode !== 'json'
                ? <div ref={host} key={mode} className="min-h-0 flex-1 overflow-hidden" data-testid="script-editor" />
                : (
                    <div className="min-h-0 flex-1 overflow-auto bg-zinc-950 py-2 font-mono text-[12px] leading-5">
                        <pre className="px-4 whitespace-pre text-zinc-300 select-text">{json}</pre>
                    </div>
                )}
        </div>
    );
}
