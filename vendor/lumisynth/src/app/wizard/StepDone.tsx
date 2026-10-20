// src/app/wizard/StepDone.tsx
// 向导第 4 步：完成。汇总这次的选择；从头播放预览、导出视频，或者关掉向导继续精修。
import { Download, Play, SlidersHorizontal } from 'lucide-react';
import { useSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { useEffectiveLyrics, useProgram } from '../DerivedProvider';
import { openExportDialog } from '../export/ExportDialog';
import { play, seek } from '../playback';
import { packLabel } from '@/i18n/catalog';
import { useTranslation } from 'react-i18next';
import { hasModeSuffix } from './themeNames';
import { formatTime, useProjectDuration } from '../Transport';
import { Button } from '../ui';
import { useAutoClipCount } from '../autoArrange/autoArrangeActions';
import { closeWizard } from './wizardStore';

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-3 border-b border-zinc-800/80 py-2 last:border-b-0">
            <span className="shrink-0 text-xs text-zinc-500">{label}</span>
            <span className="truncate text-right text-sm text-zinc-200">{value}</span>
        </div>
    );
}

export function StepDone() {
    const project = useProjectStore(state => state.project);
    const audioBuffer = useSession(state => state.audioBuffer);
    const program = useProgram();
    const effective = useEffectiveLyrics();
    const duration = useProjectDuration();
    const lineCount = effective.data?.lines.filter(line => line.fullText !== '......').length ?? 0;
    const theme = project.theme.dual[project.theme.variant];
    const { t } = useTranslation(['wizard', 'arrange', 'theme', 'workbench']);
    const style = project.direction.mode === 'mix' ? t('workbench:status.mix') : packLabel(project.direction.pack);
    const imageCount = project.assets.filter(asset => asset.kind === 'image').length;
    const autoCount = useAutoClipCount();
    const shotCount = program.paragraphs.reduce((sum, p) => sum + p.shots.length, 0);

    return (
        <div className="space-y-5">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3">
                <Row label={t('done.song')} value={[project.meta.title || t('done.untitled'), project.meta.artist].filter(Boolean).join(' · ')} />
                <Row label={t('done.audio')} value={audioBuffer ? formatTime(audioBuffer.duration) : project.audio ? t('done.decoding') : t('done.noAudio')} />
                <Row label={t('done.lyrics')} value={lineCount > 0 ? [t('arrange:storyboard.lineCount', { count: lineCount }), t('arrange:storyboard.paragraphCount', { count: program.paragraphs.length }), t('arrange:storyboard.shotCount', { count: shotCount })].join(' · ') : t('workbench:status.instrumental')} />
                <Row label={t('done.style')} value={style} />
                <Row label={t('done.aspect')} value={project.aspect} />
                <Row label={t('done.images')} value={imageCount === 0 ? t('done.none') : autoCount > 0 ? t('done.imagesPlaced', { images: t('done.imageCount', { count: imageCount }), count: autoCount }) : t('done.imagesNotPlaced', { images: t('done.imageCount', { count: imageCount }) })} />
                <Row label={t('done.colors')} value={hasModeSuffix(theme.name) ? theme.name : t('done.colorsValue', { name: theme.name, mode: t(`theme:modes.${project.theme.variant}`) })} />
                <Row label={t('done.duration')} value={formatTime(duration)} />
            </div>

            <div className="space-y-2">
                <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => {
                        closeWizard();
                        seek(0);
                        play();
                    }}
                >
                    <Play size={14} /> {t('done.play')}
                </Button>
                <Button className="w-full" onClick={() => { closeWizard(); openExportDialog(); }}>
                    <Download size={14} /> {t('done.export')}
                </Button>
                <Button variant="ghost" className="w-full" onClick={closeWizard}>
                    <SlidersHorizontal size={14} /> {t('done.refine')}
                </Button>
            </div>

            <ul className="space-y-1.5 text-[11px] leading-relaxed text-zinc-500">
                <li>· {t('done.tip1')}</li>
                <li>· {t('done.tip2')}</li>
                <li>· {t('done.tip3')}</li>
            </ul>
        </div>
    );
}
