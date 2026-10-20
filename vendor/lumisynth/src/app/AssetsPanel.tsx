// src/app/AssetsPanel.tsx
// 左栏「歌曲」：音频、歌词、译文、封面、歌曲信息。
import { ImageOff, Music, Subtitles, X } from 'lucide-react';
import { LYRIC_FILE_ACCEPT } from '@/core/lyrics/load';
import { clearCover, clearLyrics, importAudioFile, importCoverFile, importLyricsFile } from '@/project/actions';
import { useSession } from '@/project/session';
import { updateProject, useProjectStore } from '@/project/store';
import { useEffectiveLyrics } from './DerivedProvider';
import { DropZone } from './DropZone';
import { formatTime } from './Transport';
import { Button, Field, FileButton, inputClass, Section } from './ui';
import { useTranslation } from 'react-i18next';
import { t as translate } from '@/i18n';

const FORMAT_LABELS: Record<string, string> = {
    lrc: 'LRC', vtt: 'WebVTT', ttml: 'TTML', yrc: 'YRC', qrc: 'QRC', krc: 'KRC',
    awlrc: 'AWLRC', srt: 'SRT', ass: 'ASS', fia: 'Folia',
};

const formatLabel = (format: string | null) => (format === 'enhanced-lrc' ? translate('song:enhancedLrc') : FORMAT_LABELS[format ?? ''] ?? format);

function FileRow({ icon, name, detail, onClear }: { icon: React.ReactNode; name: string; detail?: string; onClear?: () => void }) {
    const { t } = useTranslation('song');
    return (
        <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
            <span className="text-zinc-500">{icon}</span>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-zinc-200">{name}</div>
                {detail && <div className="truncate text-[11px] text-zinc-500">{detail}</div>}
            </div>
            {onClear && (
                <button type="button" onClick={onClear} className="text-zinc-500 hover:text-zinc-200" aria-label={t('remove')}>
                    <X size={14} />
                </button>
            )}
        </div>
    );
}

export function AssetsPanel() {
    const audio = useProjectStore(state => state.project.audio);
    const lyrics = useProjectStore(state => state.project.lyrics);
    const translation = useProjectStore(state => state.project.translation);
    const meta = useProjectStore(state => state.project.meta);
    const coverUrl = useSession(state => state.coverUrl);
    const audioBuffer = useSession(state => state.audioBuffer);
    const progress = useSession(state => state.analysisProgress);
    const error = useSession(state => state.error);
    const effective = useEffectiveLyrics();
    const lineCount = effective.data?.lines.filter(line => line.fullText !== '......').length ?? 0;
    const { t } = useTranslation('song');

    return (
        <>
            <Section title={t('assets.audioAndLyrics')}>
                <DropZone target="audio" label={audio ? t('assets.dropReplaceAudio') : t('assets.dropAudio')} className="space-y-2">
                {audio ? (
                    <FileRow
                        icon={<Music size={15} />}
                        name={audio.name}
                        detail={progress !== null
                            ? t('assets.analyzing', { percent: Math.round(progress * 100) })
                            : audioBuffer ? `${formatTime(audioBuffer.duration)} · ${audioBuffer.sampleRate / 1000} kHz` : t('assets.decoding')}
                    />
                ) : (
                    <div className="text-xs text-zinc-500">{t('assets.noAudio')}</div>
                )}
                <FileButton accept="audio/*" onFile={file => void importAudioFile(file)} className="w-full">
                    <Music size={14} /> {audio ? t('assets.replaceAudio') : t('assets.chooseAudio')}
                </FileButton>
                </DropZone>

                <DropZone target="lyrics" label={lyrics ? t('assets.dropReplaceLyrics') : t('assets.dropLyrics')} className="space-y-2">
                {lyrics ? (
                    <FileRow
                        icon={<Subtitles size={15} />}
                        name={lyrics.fileName}
                        detail={effective.error
                            ? t('assets.parseFailed', { error: effective.error })
                            : `${formatLabel(effective.format)} · ${t('assets.lineCount', { count: lineCount })}${effective.data?.isWordByWord ? ` · ${t('assets.wordByWord')}` : ''}`}
                        onClear={() => clearLyrics('lyrics')}
                    />
                ) : (
                    <div className="text-xs text-zinc-500">{t('assets.noLyrics')}</div>
                )}
                <FileButton accept={LYRIC_FILE_ACCEPT} onFile={file => void importLyricsFile(file)} className="w-full">
                    <Subtitles size={14} /> {lyrics ? t('assets.replaceLyrics') : t('assets.chooseLyrics')}
                </FileButton>
                </DropZone>
                {lyrics && (
                    <DropZone target="translation" label={t('assets.dropTranslation')}>
                    {translation ? (
                        <FileRow icon={<Subtitles size={15} />} name={translation.fileName} detail={t('assets.translation')} onClear={() => clearLyrics('translation')} />
                    ) : (
                        <FileButton
                            variant="ghost"
                            size="sm"
                            accept={LYRIC_FILE_ACCEPT}
                            onFile={file => void importLyricsFile(file, 'translation')}
                            className="w-full"
                        >
                            {t('assets.addTranslation')}
                        </FileButton>
                    )}
                    </DropZone>
                )}
                {effective.invalidEdits.length > 0 && (
                    <div className="rounded-md border border-amber-900/60 bg-amber-950/40 px-2 py-1.5 text-xs text-amber-200">
                        {t('assets.invalidEdits', { count: effective.invalidEdits.length })}
                    </div>
                )}
                {error && <div className="rounded-md bg-red-950/60 px-2 py-1.5 text-xs text-red-200">{error}</div>}
            </Section>

            <Section title={t('assets.info')}>
                <DropZone target="cover" label={t('assets.dropCover')} className="flex gap-3">
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
                        {coverUrl ? (
                            <img src={coverUrl} alt={t('assets.cover')} className="h-full w-full object-cover" />
                        ) : (
                            <div className="flex h-full items-center justify-center text-zinc-600"><ImageOff size={20} /></div>
                        )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
                        <FileButton size="sm" accept="image/*" onFile={file => void importCoverFile(file)}>
                            {coverUrl ? t('assets.replaceCover') : t('assets.chooseCover')}
                        </FileButton>
                        {coverUrl && <Button size="sm" variant="ghost" onClick={clearCover}>{t('assets.removeCover')}</Button>}
                    </div>
                </DropZone>
                {(['title', 'artist', 'album'] as const).map(key => (
                    <Field key={key} label={t(`assets.meta.${key}`)}>
                        <input
                            value={meta[key]}
                            onChange={event => updateProject(
                                p => ({ ...p, meta: { ...p.meta, [key]: event.target.value } }),
                                { coalesce: `meta.${key}` },
                            )}
                            className={inputClass}
                        />
                    </Field>
                ))}
            </Section>
        </>
    );
}
