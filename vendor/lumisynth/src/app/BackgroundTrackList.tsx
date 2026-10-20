// src/app/BackgroundTrackList.tsx
// 「画面与编排 › 背景与后处理」里的背景轨：列出片段（点一下选中，在检查器里编辑），添加新片段。
import { Plus } from 'lucide-react';
import { useProjectStore } from '@/project/store';
import { useSession } from '@/project/session';
import { setSession } from '@/project/session';
import { addBackgroundAt, describeBackground } from './backgroundActions';
import { Button, cx } from './ui';
import { useTranslation } from 'react-i18next';
import { timingLabel } from './clipActions';

export function BackgroundTrackList() {
    const clips = useProjectStore(state => state.project.backgroundClips);
    const selection = useSession(state => state.selection);
    const { t } = useTranslation('media');
    return (
        <div className="space-y-1.5">
            <div className="text-xs text-zinc-400">{t('backgroundTrack.title')}</div>
            {clips.length === 0 && <div className="text-[11px] text-zinc-500">{t('backgroundTrack.empty')}</div>}
            {[...clips].reverse().map(clip => (
                <button
                    key={clip.id}
                    type="button"
                    onClick={() => setSession({ selection: { type: 'background', clipId: clip.id } })}
                    className={cx(
                        'block w-full truncate rounded border px-2 py-1 text-left text-xs',
                        selection.type === 'background' && selection.clipId === clip.id ? 'border-violet-300 bg-violet-500/20 text-violet-50' : 'border-zinc-800 text-zinc-300 hover:border-zinc-600',
                    )}
                >
                    {describeBackground(clip)}
                </button>
            ))}
            <div className="flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => addBackgroundAt({ type: 'gradient', from: '#1e1b4b', to: '#0f766e', angle: 20 }, 'paragraph')}>
                    <Plus size={12} /> {t('backgroundTrack.addParagraph')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => addBackgroundAt({ type: 'gradient', from: '#1e1b4b', to: '#0f766e', angle: 20 }, 'song')}>
                    {timingLabel('song')}
                </Button>
            </div>
            <div className="text-[11px] text-zinc-500">{t('backgroundTrack.hint')}</div>
        </div>
    );
}
