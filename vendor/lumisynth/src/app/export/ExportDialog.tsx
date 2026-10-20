// src/app/export/ExportDialog.tsx
// 导出视频对话框：分辨率、帧率、格式、画质、范围；进度与取消。
import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { create } from 'zustand';
import {
    ExportCancelled,
    exportVideo,
    supportsWebCodecs,
    type ExportFormat,
    type ExportProgress,
    type ExportQuality,
    type ExportResult,
} from '@/export/exporter';
import { buildProjectExportInput, exportFileName, exportSizeFor } from '@/export/projectExport';
import { exportLayered, groupName, groupsFromSplits, layerLabel, LAYER_PRESETS, splitsFromGroups, type LayeredResult, type SeparateEffect } from '@/export/layered';
import { useTranslation } from 'react-i18next';
import { KERNEL_LAYERS } from '@/kernel/layerIds';
import { useSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { useProgram } from '../DerivedProvider';
import { isMobileLayoutNow } from '../mobile/uiMode';
import { downloadBlob } from '../download';
import { backdrop, overlay, popIn, popTransition, presence } from '../motion';
import { log } from '../output';
import { pause, usePlayback } from '../playback';
import { formatTime, useProjectDuration } from '../Transport';
import { Button, Field, inputClass, Segmented, Toggle } from '../ui';

export const useExportDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openExportDialog = () => {
    pause();
    useExportDialog.setState({ open: true });
};

const SHORT_SIDES = [720, 1080, 1440, 2160] as const;

/** 导出结果、错误提示出现时轻轻落下。 */
const resultIn = { initial: { opacity: 0, y: -4 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2 } } as const;

const formatBytes = (bytes: number) => (bytes > 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`);

export function ExportDialog() {
    const open = useExportDialog(state => state.open);
    return <AnimatePresence>{open && <ExportDialogBody />}</AnimatePresence>;
}

function ExportDialogBody() {
    const project = useProjectStore(state => state.project);
    const program = useProgram();
    const session = useSession();
    const duration = useProjectDuration();
    const playheadTime = usePlayback(state => state.time);
    const { t } = useTranslation(['export', 'common']);

    // 移动端默认 720p：编码器与内存都更吃紧。
    const [shortSide, setShortSide] = useState<number>(() => (isMobileLayoutNow() ? 720 : 1080));
    const [fps, setFps] = useState(30);
    const [format, setFormat] = useState<ExportFormat>('mp4');
    const [quality, setQuality] = useState<ExportQuality>('high');
    const [range, setRange] = useState<'all' | 'custom'>('all');
    const [start, setStart] = useState(0);
    const [end, setEnd] = useState(duration);
    const [progress, setProgress] = useState<ExportProgress | null>(null);
    const [result, setResult] = useState<ExportResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const controller = useRef<AbortController | null>(null);
    // 分层导出
    const [mode, setMode] = useState<'single' | 'layered'>('single');
    const [preset, setPreset] = useState<'two' | 'four' | 'custom'>('two');
    const [splits, setSplits] = useState<Set<number>>(() => splitsFromGroups(LAYER_PRESETS.two));
    const [postTarget, setPostTarget] = useState<'top' | 'none' | number>('top');
    const [separate, setSeparate] = useState<Set<SeparateEffect>>(new Set());
    const [layeredResult, setLayeredResult] = useState<LayeredResult | null>(null);
    const groups = preset === 'custom' ? groupsFromSplits(splits) : LAYER_PRESETS[preset];
    const resolvedPostTarget = postTarget === 'none' ? null : postTarget === 'top' ? groups.length - 1 : Math.min(postTarget, groups.length - 1);
    const postProcess = project.tuning.kernel.postProcess;

    const { width, height } = exportSizeFor(project, shortSide);
    const from = range === 'all' ? 0 : Math.max(0, Math.min(start, duration));
    const to = range === 'all' ? duration : Math.max(from + 0.5, Math.min(end, duration));
    const running = progress !== null && result === null && layeredResult === null && error === null;

    useEffect(() => () => controller.current?.abort(), []);

    // Esc 关闭（导出进行中不关，免得误触丢掉进度）。
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !running) useExportDialog.setState({ open: false });
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [running]);

    const close = () => {
        controller.current?.abort();
        useExportDialog.setState({ open: false });
    };

    const start_ = async () => {
        setError(null);
        setResult(null);
        setLayeredResult(null);
        const abort = new AbortController();
        controller.current = abort;
        setProgress({ phase: 'preparing', frame: 0, totalFrames: 1, elapsed: 0, remaining: null });
        try {
            if (mode === 'layered') {
                const output = await exportLayered(
                    buildProjectExportInput(project, program, session),
                    { width, height, fps, format, quality, start: from, end: to },
                    { groups, postTarget: resolvedPostTarget, separateEffects: [...separate] },
                    setProgress,
                    abort.signal,
                );
                setLayeredResult(output);
                downloadBlob(output.blob, exportFileName(project, 'layers.zip'));
                log(t('dialog.layeredDone', {
                    layers: t('dialog.layerCount', { count: groups.length }),
                    effects: separate.size ? t('dialog.effectLayers', { count: separate.size }) : '',
                    size: formatBytes(output.blob.size),
                    png: output.alphaMethod === 'png-sequence' ? t('dialog.pngNote') : '',
                }));
                return;
            }
            const output = await exportVideo(
                buildProjectExportInput(project, program, session),
                { width, height, fps, format, quality, start: from, end: to },
                setProgress,
                abort.signal,
            );
            setResult(output);
            downloadBlob(output.blob, exportFileName(project, output.extension));
            log(t('dialog.done', { format: `${width}×${height} ${fps}fps ${output.videoCodec}${output.audioCodec ? ` + ${output.audioCodec}` : ''}`, size: formatBytes(output.blob.size) }));
        } catch (reason) {
            if (reason instanceof ExportCancelled) {
                setProgress(null);
                log(t('cancelled'), 'warn');
                return;
            }
            const message = (reason as Error).message;
            setError(message);
            log(t('dialog.failed', { message }), 'error');
        }
    };

    const percent = progress ? Math.round((progress.frame / Math.max(1, progress.totalFrames)) * 100) : 0;

    return (
        <motion.div {...presence} variants={overlay} className="no-drag fixed inset-0 z-50 flex items-center justify-center">
            <motion.div variants={backdrop} transition={popTransition} className="absolute inset-0 bg-black/60" onMouseDown={() => { if (!running) close(); }} />
            <motion.div
                data-testid="export-dialog"
                role="dialog"
                aria-label={t('dialog.title')}
                variants={popIn}
                transition={{ type: 'spring', stiffness: 520, damping: 36 }}
                className="relative flex max-h-[calc(100vh-32px)] w-[min(460px,calc(100vw-32px))] flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
            >
                <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-2.5">
                    <h2 className="text-sm font-semibold text-zinc-100">{t('dialog.title')}</h2>
                    <button type="button" onClick={close} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label={t('common:close')}><X size={15} /></button>
                </header>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                    {!supportsWebCodecs() && (
                        <div className="rounded-md bg-amber-950/50 px-2 py-1.5 text-xs text-amber-200">
                            {t('dialog.noWebCodecs')}
                        </div>
                    )}
                    {isMobileLayoutNow() && shortSide > 1080 && (
                        <div className="rounded-md bg-amber-950/50 px-2 py-1.5 text-xs text-amber-200">
                            {t('dialog.mobileWarning')}
                        </div>
                    )}
                    <Field label={t('dialog.resolution', { aspect: project.aspect })}>
                        <Segmented<string>
                            value={String(shortSide)}
                            onChange={value => setShortSide(Number(value))}
                            options={SHORT_SIDES.map(side => ({ value: String(side), label: side === 2160 ? '4K' : `${side}p` }))}
                        />
                        <div className="mt-1 text-[11px] text-zinc-500 tabular-nums">{width} × {height}</div>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label={t('dialog.fps')}>
                            <Segmented<string> value={String(fps)} onChange={value => setFps(Number(value))} options={[24, 30, 60].map(value => ({ value: String(value), label: String(value) }))} />
                        </Field>
                        <Field label={t('dialog.format')}>
                            <Segmented<ExportFormat> value={format} onChange={setFormat} options={[{ value: 'mp4', label: 'MP4' }, { value: 'webm', label: 'WebM' }]} />
                        </Field>
                    </div>
                    <Field label={t('dialog.quality')}>
                        <Segmented<ExportQuality> value={quality} onChange={setQuality} options={[{ value: 'medium', label: t('dialog.qualityMedium') }, { value: 'high', label: t('dialog.qualityHigh') }, { value: 'very-high', label: t('dialog.qualityVeryHigh') }]} />
                    </Field>
                    <Field label={t('dialog.range')}>
                        <Segmented<'all' | 'custom'> value={range} onChange={setRange} options={[{ value: 'all', label: t('dialog.rangeAll', { duration: formatTime(duration) }) }, { value: 'custom', label: t('dialog.custom') }]} />
                        {range === 'custom' && (
                            <div className="mt-2 grid grid-cols-2 gap-2">
                                <label className="text-[11px] text-zinc-500">{t('common:startSeconds')}
                                    <input type="number" step={0.1} value={start} onChange={event => setStart(Number(event.target.value))} className={inputClass} />
                                </label>
                                <label className="text-[11px] text-zinc-500">{t('common:endSeconds')}
                                    <input type="number" step={0.1} value={end} onChange={event => setEnd(Number(event.target.value))} className={inputClass} />
                                </label>
                                <Button size="sm" variant="ghost" onClick={() => setStart(Number(playheadTime.toFixed(2)))}>{t('dialog.startAtPlayhead')}</Button>
                                <Button size="sm" variant="ghost" onClick={() => setEnd(Number(playheadTime.toFixed(2)))}>{t('dialog.endAtPlayhead')}</Button>
                            </div>
                        )}
                    </Field>
                    <Field label={t('dialog.output')}>
                        <Segmented<'single' | 'layered'> value={mode} onChange={setMode} options={[{ value: 'single', label: t('dialog.single') }, { value: 'layered', label: t('dialog.layered') }]} />
                    </Field>
                    {mode === 'layered' && (
                        <div className="space-y-2 rounded-md border border-zinc-800 p-2">
                            <Segmented<'two' | 'four' | 'custom'>
                                value={preset}
                                onChange={value => {
                                    setPreset(value);
                                    if (value !== 'custom') setSplits(splitsFromGroups(LAYER_PRESETS[value]));
                                }}
                                options={[{ value: 'two', label: t('dialog.presetTwo') }, { value: 'four', label: t('dialog.presetFour') }, { value: 'custom', label: t('dialog.custom') }]}
                            />
                            {preset === 'custom' ? (
                                <div className="text-[11px]">
                                    {KERNEL_LAYERS.map((layer, index) => (
                                        <div key={layer}>
                                            <div className="text-zinc-300">{layerLabel(layer)}</div>
                                            {index < KERNEL_LAYERS.length - 1 && (
                                                <label className="flex cursor-pointer items-center gap-1.5 py-0.5 pl-3 text-zinc-500">
                                                    <input
                                                        type="checkbox"
                                                        aria-label={t('dialog.splitAfter', { layer: layerLabel(layer) })}
                                                        checked={splits.has(index)}
                                                        onChange={event => {
                                                            const next = new Set(splits);
                                                            if (event.target.checked) next.add(index);
                                                            else next.delete(index);
                                                            setSplits(next);
                                                        }}
                                                        className="accent-amber-400"
                                                    />
                                                    {splits.has(index) ? t('dialog.splitHere') : t('dialog.sameFile')}
                                                </label>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                            <ol className="space-y-0.5 text-[11px] text-zinc-400">
                                {groups.map((group, index) => (
                                    <li key={index}>{index + 1}. {groupName(group)}{index === 0 ? t('dialog.opaque') : t('dialog.transparent')}</li>
                                ))}
                            </ol>
                            {postProcess.enabled && (
                                <>
                                    <Field label={t('dialog.postTarget')}>
                                        <select
                                            aria-label={t('dialog.postTargetLabel')}
                                            value={postTarget === 'top' ? 'top' : postTarget === 'none' ? 'none' : String(postTarget)}
                                            onChange={event => setPostTarget(event.target.value === 'top' || event.target.value === 'none' ? event.target.value : Number(event.target.value))}
                                            className={inputClass}
                                        >
                                            <option value="top">{t('dialog.postTop', { name: groupName(groups.at(-1)!) })}</option>
                                            {groups.slice(0, -1).map((group, index) => <option key={index} value={index}>{t('dialog.postLayer', { n: index + 1, name: groupName(group) })}</option>)}
                                            <option value="none">{t('dialog.postNone')}</option>
                                        </select>
                                    </Field>
                                    {(['vignette', 'grain'] as SeparateEffect[]).filter(effect => postProcess[effect] > 0).map(effect => (
                                        <Toggle
                                            key={effect}
                                            label={effect === 'vignette' ? t('dialog.separateVignette') : t('dialog.separateGrain')}
                                            checked={separate.has(effect)}
                                            onChange={checked => {
                                                const next = new Set(separate);
                                                if (checked) next.add(effect);
                                                else next.delete(effect);
                                                setSeparate(next);
                                            }}
                                        />
                                    ))}
                                </>
                            )}
                            <div className="text-[11px] text-zinc-500">
                                {t('dialog.layeredHint')}
                            </div>
                        </div>
                    )}
                    {!session.audioBuffer && <div className="text-[11px] text-zinc-500">{t('dialog.noAudio')}</div>}

                    {progress && (
                        <div className="space-y-1">
                            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                                <div className="h-full bg-amber-400 transition-[width]" style={{ width: `${progress.phase === 'finalizing' ? 100 : percent}%` }} />
                            </div>
                            <div className="flex justify-between text-[11px] text-zinc-400 tabular-nums">
                                <span>
                                    {progress.phase === 'preparing' && t('dialog.preparing')}
                                    {progress.phase === 'rendering' && t('dialog.rendering', { frame: progress.frame, count: progress.totalFrames })}
                                    {progress.phase === 'finalizing' && t('dialog.finalizing')}
                                </span>
                                <span>{progress.remaining !== null && progress.phase === 'rendering' ? t('dialog.remaining', { time: formatTime(progress.remaining) }) : ''}</span>
                            </div>
                        </div>
                    )}
                    {layeredResult && (
                        <motion.div {...resultIn} className="rounded-md bg-emerald-950/50 px-2 py-1.5 text-xs text-emerald-200">
                            {t(layeredResult.alphaMethod === 'png-sequence' ? 'dialog.layeredResultPng' : 'dialog.layeredResult', { size: formatBytes(layeredResult.blob.size), count: layeredResult.files.length })}
                        </motion.div>
                    )}
                    {result && (
                        <motion.div {...resultIn} className="rounded-md bg-emerald-950/50 px-2 py-1.5 text-xs text-emerald-200">
                            {t('dialog.result', { size: formatBytes(result.blob.size), codec: `${result.videoCodec}${result.audioCodec ? ` + ${result.audioCodec}` : ''}` })}
                        </motion.div>
                    )}
                    {error && <motion.div {...resultIn} className="rounded-md bg-red-950/60 px-2 py-1.5 text-xs text-red-200">{error}</motion.div>}
                </div>
                <footer className="flex shrink-0 justify-end gap-2 border-t border-zinc-800 px-4 py-2.5">
                    {running
                        ? <Button variant="danger" onClick={() => controller.current?.abort()}>{t('dialog.cancel')}</Button>
                        : <Button onClick={close}>{t('common:close')}</Button>}
                    <Button variant="primary" disabled={running} onClick={() => void start_()}>
                        <Download size={14} /> {result || layeredResult ? t('dialog.again') : t('dialog.start')}
                    </Button>
                </footer>
            </motion.div>
        </motion.div>
    );
}
