// src/app/wizard/StepAssets.tsx
// 向导第 3 步：素材图片（可选）。拖进来或多选导入，默认自动编排到画面上（场景之上、歌词之下，贴在场景上）；
// 改选项立刻重新编排，预览里马上看到。没有素材就直接下一步。
import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { IMAGE_ACCEPT } from '@/project/assets';
import { useProjectStore } from '@/project/store';
import { ArrangeOptionsFields } from '../autoArrange/AutoArrangePanel';
import { autoArrangeAssets, clearAutoArrangement, useArrangeOptions, useAutoClipCount } from '../autoArrange/autoArrangeActions';
import { DropZone } from '../DropZone';
import { FileButton, Toggle } from '../ui';
import { AssetThumb, importLibraryFiles } from '../views/LibraryView';
import { useTranslation } from 'react-i18next';

export function StepAssets() {
    // 选择器返回同一个数组，在组件里再过滤：选择器每次返回新数组会让 zustand 以为状态一直在变。
    const assets = useProjectStore(state => state.project.assets);
    const images = useMemo(() => assets.filter(asset => asset.kind === 'image'), [assets]);
    const options = useArrangeOptions();
    const autoCount = useAutoClipCount();
    const { t } = useTranslation(['wizard', 'media']);
    const [arrange, setArrange] = useState(true);
    const imageKey = images.map(image => image.id).join(',');
    const first = useRef(true);

    // 图片或选项变了就重新编排（只替换自动编排的片段）；刚进这一步时如果已经编排过就不动。
    useEffect(() => {
        if (first.current) {
            first.current = false;
            if (autoCount > 0 || images.length === 0) return;
        }
        if (!arrange) {
            clearAutoArrangement();
            return;
        }
        if (images.length > 0) autoArrangeAssets(null, options);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [imageKey, options, arrange]);

    return (
        <div className="space-y-5">
            <p className="text-sm leading-relaxed text-zinc-400">{t('assets.intro')}</p>
            <DropZone target="library" label={t('media:library.drop')} className="space-y-2.5 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-3">
                <div className="flex items-center gap-2">
                    <ImagePlus size={16} className="shrink-0 text-zinc-400" />
                    <span className="flex-1 text-sm text-zinc-200">{images.length > 0 ? t('done.imageCount', { count: images.length }) : t('assets.drop')}</span>
                    <FileButton size="sm" accept={IMAGE_ACCEPT} multiple onFiles={files => void importLibraryFiles(files)}>{t('assets.choose')}</FileButton>
                </div>
                {images.length > 0 && (
                    <div className="grid grid-cols-5 gap-1.5">
                        {images.map(image => (
                            <AssetThumb key={image.id} assetId={image.id} className="flex aspect-square items-center justify-center overflow-hidden rounded bg-[repeating-conic-gradient(#27272a_0_25%,#18181b_0_50%)] bg-[length:10px_10px]" />
                        ))}
                    </div>
                )}
            </DropZone>

            <div className="space-y-2.5">
                <Toggle label={t('media:library.autoArrange')} checked={arrange} onChange={setArrange} />
                {arrange && (
                    <>
                        <ArrangeOptionsFields />
                        <div className="text-[11px] text-zinc-500">
                            {autoCount > 0 ? t('assets.placed', { count: autoCount }) : ''}{t('assets.explain')}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
