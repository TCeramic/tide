// src/app/views/LibraryView.tsx
// 主侧栏「素材库」：工程里的图片。可以摆到画面上（素材层，与风格包无关），也可以交给凝彩自动取用。
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ImagePlus, LayoutTemplate, Plus, Trash2, Wallpaper } from 'lucide-react';
import type { ClipTiming } from '@/core/assets/clips';
import type { BackgroundSource } from '@/core/assets/background';
import { addBackgroundAt } from '../backgroundActions';
import { addAssetClip, IMAGE_ACCEPT, importLibraryFile, isInTemperaPool, VIDEO_ACCEPT, removeLibraryAsset, renameLibraryAsset, setTemperaAuto, type LibraryAsset } from '@/project/assets';
import { setSession, useSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { locateAt } from '../arrangeActions';
import { useProgram } from '../DerivedProvider';
import { DropZone } from '../DropZone';
import { log } from '../output';
import { clock } from '../playback';
import { cx, FileButton } from '../ui';
import { showContextMenu, type ContextMenuItem } from '../workbench/ContextMenu';
import { AutoArrangePanel } from '../autoArrange/AutoArrangePanel';
import { useAutoClipCount } from '../autoArrange/autoArrangeActions';
import { useTranslation } from 'react-i18next';
import { t as translate } from '@/i18n';
import { packShortLabel } from '@/i18n/catalog';

export function AssetThumb({ assetId, className }: { assetId: string; className?: string }) {
    const blob = useSession(state => state.assetBlobs.get(assetId));
    const isVideo = useProjectStore(state => state.project.assets.find(item => item.id === assetId)?.kind === 'video');
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!blob) return;
        const next = URL.createObjectURL(blob);
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [blob]);
    return (
        <div className={className ?? 'flex aspect-square items-center justify-center bg-[repeating-conic-gradient(#27272a_0_25%,#18181b_0_50%)] bg-[length:12px_12px]'}>
            {url && (isVideo
                ? <video src={`${url}#t=0.1`} muted preload="metadata" className="max-h-full max-w-full object-contain" />
                : <img src={url} alt="" draggable={false} className="max-h-full max-w-full object-contain" />)}
        </div>
    );
}

/** 在播放头处插入：挂在播放头所在的镜头上；没有镜头时用 4 秒的绝对时间。 */
export const insertAssetAtPlayhead = (asset: LibraryAsset, program: ReturnType<typeof useProgram>) => {
    const time = clock.get();
    const { shot } = locateAt(program, time);
    const timing: ClipTiming = shot && time < shot.endTime
        ? { type: 'shot', anchor: shot.anchor }
        : { type: 'absolute', start: time, end: time + 4 };
    const clip = addAssetClip(asset.id, timing);
    setSession({ selection: { type: 'clip', clipId: clip.id } });
    log(translate(timing.type === 'shot' ? 'media:library.placedFollowing' : 'media:library.placed', { name: asset.name }));
};

/** 一次导入多个文件：一个一个来（解码占内存），最后报个总数；坏文件单独报错，不影响其余的。 */
export const importLibraryFiles = async (files: File[]) => {
    let imported = 0;
    for (const file of files) {
        try {
            await importLibraryFile(file);
            imported += 1;
        } catch (reason) {
            log(translate('media:library.importFailed', { name: file.name, message: (reason as Error).message }), 'error');
        }
    }
    if (imported > 0) {
        log(files.length === 1
            ? translate('media:library.imported', { name: files[0].name })
            : imported < files.length
                ? translate('media:library.importedSomeFailed', { count: imported, failed: files.length - imported })
                : translate('media:library.importedMany', { count: imported }));
    }
};

export function LibraryView() {
    const assets = useProjectStore(state => state.project.assets);
    const clips = useProjectStore(state => state.project.assetClips);
    const project = useProjectStore(state => state.project);
    const program = useProgram();
    const [renaming, setRenaming] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [arrangeOpen, setArrangeOpen] = useState(false);
    const autoCount = useAutoClipCount();
    const { t } = useTranslation('media');
    const images = assets;
    // 选中的只算还在素材库里的图片（视频不能摆到画面上）。
    const selectedImages = assets.filter(asset => asset.kind === 'image' && selected.has(asset.id)).map(asset => asset.id);
    const imageCount = assets.filter(asset => asset.kind === 'image').length;
    // 选中的集合里可能留着已经删掉的素材：数量只算还在的。
    const selectedCount = assets.filter(asset => selected.has(asset.id)).length;
    const toggle = (id: string) => setSelected(current => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });
    const backgroundSource = (asset: LibraryAsset): BackgroundSource => (asset.kind === 'video'
        ? { type: 'video', assetId: asset.id, offset: 0, loop: true }
        : { type: 'image', assetId: asset.id });

    const menu = (asset: LibraryAsset): ContextMenuItem[] => [
        ...(asset.kind === 'image' ? [
            { label: t('library.place'), run: () => insertAssetAtPlayhead(asset, program) },
            { label: t('library.temperaAuto', { pack: packShortLabel('tempera') }), checked: isInTemperaPool(project, asset.id), run: () => setTemperaAuto(asset.id, !isInTemperaPool(project, asset.id)) },
        ] : []),
        { label: t('library.setBackgroundParagraph'), run: () => addBackgroundAt(backgroundSource(asset), 'paragraph') },
        { label: t('library.setBackgroundSong'), run: () => addBackgroundAt(backgroundSource(asset), 'song') },
        { label: t('library.rename'), run: () => setRenaming(asset.id) },
        'separator',
        { label: clips.some(clip => clip.assetId === asset.id) ? t('library.deleteWithClips') : t('library.delete'), run: () => removeLibraryAsset(asset.id) },
    ];

    return (
        <DropZone target="library" label={t('library.drop')} className="min-h-full space-y-2 px-3 py-2">
            <FileButton
                accept={`${IMAGE_ACCEPT},${VIDEO_ACCEPT}`}
                className="w-full"
                multiple
                onFiles={files => void importLibraryFiles(files)}
            >
                <ImagePlus size={14} /> {t('library.add')}
            </FileButton>
            <div className="rounded-md border border-zinc-800">
                <button
                    type="button"
                    aria-expanded={arrangeOpen}
                    onClick={() => setArrangeOpen(open => !open)}
                    className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800/60"
                >
                    {arrangeOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <LayoutTemplate size={13} className="text-amber-400" />
                    {t('library.autoArrange')}
                    {autoCount > 0 && <span className="ml-auto text-[11px] text-zinc-500">{t('library.placedCount', { count: autoCount })}</span>}
                </button>
                {arrangeOpen && (
                    <div className="border-t border-zinc-800 px-2.5 py-2.5">
                        <AutoArrangePanel
                            assetIds={selectedImages.length > 0 ? selectedImages : null}
                            imageCount={selectedImages.length > 0 ? selectedImages.length : imageCount}
                        />
                    </div>
                )}
            </div>
            {selectedCount > 0 && (
                <div className="flex items-center gap-1 rounded-md bg-zinc-800/70 px-2 py-1 text-[11px] text-zinc-300">
                    <span>{t('library.selected', { count: selectedCount })}</span>
                    <button type="button" className="ml-auto rounded px-1.5 py-0.5 hover:bg-zinc-700" onClick={() => setSelected(new Set(assets.map(asset => asset.id)))}>{t('library.selectAll')}</button>
                    <button type="button" className="rounded px-1.5 py-0.5 hover:bg-zinc-700" onClick={() => setSelected(new Set())}>{t('library.selectNone')}</button>
                    <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-red-300 hover:bg-red-950/60"
                        onClick={() => {
                            [...selected].forEach(id => removeLibraryAsset(id));
                            setSelected(new Set());
                        }}
                    >
                        {t('library.deleteSelected')}
                    </button>
                </div>
            )}
            <div className="text-[11px] text-zinc-500">
                {t('library.hint')}
            </div>
            {images.length === 0 && <div className="py-6 text-center text-xs text-zinc-600">{t('library.empty')}</div>}
            <div className="grid grid-cols-2 gap-2">
                {images.map(asset => {
                    const used = clips.filter(clip => clip.assetId === asset.id).length;
                    const auto = isInTemperaPool(project, asset.id);
                    const checked = selected.has(asset.id);
                    return (
                        <div
                            key={asset.id}
                            data-asset-card={asset.id}
                            onContextMenu={event => showContextMenu(event, menu(asset))}
                            className={cx('group overflow-hidden rounded-md border bg-zinc-900', checked ? 'border-amber-400/80' : 'border-zinc-800')}
                        >
                            <div className="relative">
                                <AssetThumb assetId={asset.id} />
                                <input
                                    type="checkbox"
                                    aria-label={t('library.select', { name: asset.name })}
                                    checked={checked}
                                    onChange={() => toggle(asset.id)}
                                    className={cx('absolute top-1 left-1 transition-opacity', checked || selectedCount > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
                                />
                                {asset.kind === 'video' && <span className="absolute bottom-1 left-1 rounded bg-zinc-950/80 px-1 text-[10px] text-violet-200">{t('library.videoBadge')}</span>}
                                <div className="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                    {asset.kind === 'image' && <button type="button" aria-label={t('library.placeNamed', { name: asset.name })} title={t('library.place')} onClick={() => insertAssetAtPlayhead(asset, program)} className="rounded bg-zinc-950/80 p-1 text-zinc-200 hover:text-amber-300"><Plus size={12} /></button>}
                                    <button type="button" aria-label={t('library.setBackgroundNamed', { name: asset.name })} title={t('library.setBackgroundHint')} onClick={() => addBackgroundAt(backgroundSource(asset), 'paragraph')} className="rounded bg-zinc-950/80 p-1 text-zinc-200 hover:text-violet-300"><Wallpaper size={12} /></button>
                                    <button type="button" aria-label={t('library.deleteNamed', { name: asset.name })} title={t('library.delete')} onClick={() => removeLibraryAsset(asset.id)} className="rounded bg-zinc-950/80 p-1 text-zinc-400 hover:text-red-300"><Trash2 size={12} /></button>
                                </div>
                            </div>
                            <div className="px-1.5 py-1 text-[11px]">
                                {renaming === asset.id ? (
                                    <input
                                        autoFocus
                                        defaultValue={asset.name}
                                        onBlur={event => { renameLibraryAsset(asset.id, event.target.value.trim() || asset.name); setRenaming(null); }}
                                        onKeyDown={event => { if (event.key === 'Enter' || event.key === 'Escape') (event.target as HTMLInputElement).blur(); }}
                                        className="w-full bg-zinc-800 px-1 text-zinc-100 outline-none select-text"
                                    />
                                ) : (
                                    <div className="truncate text-zinc-200" title={asset.name} onDoubleClick={() => setRenaming(asset.id)}>{asset.name}</div>
                                )}
                                <div className="flex items-center gap-1 text-zinc-500">
                                    {asset.width > 0 && <span>{asset.width}×{asset.height}</span>}
                                    {asset.kind === 'video' && asset.duration ? <span>· {asset.duration.toFixed(1)}s</span> : null}
                                    {used > 0 && <span>· {t('library.usedCount', { count: used })}</span>}
                                    {asset.kind === 'image' && <button
                                        type="button"
                                        onClick={() => setTemperaAuto(asset.id, !auto)}
                                        title={t('library.temperaAutoHint', { pack: packShortLabel('tempera') })}
                                        className={cx('ml-auto rounded px-1', auto ? 'bg-amber-400/15 text-amber-300' : 'text-zinc-600 hover:text-zinc-300')}
                                    >
                                        {packShortLabel('tempera')}
                                    </button>}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </DropZone>
    );
}
