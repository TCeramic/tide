// src/packs/tempera/settings.tsx
// 凝彩的设置面板：观感开关、运动、图片池、切块参数。
import { ImagePlus, X } from 'lucide-react';
import { Field, FileButton, inputClass, Segmented, Slider, Toggle } from '@/app/ui';
import type { PackSettingsProps } from '@/packs/contract';
import { IMAGE_ACCEPT, importLibraryImage, setTemperaAuto } from '@/project/assets';
import { useProjectStore } from '@/project/store';
import type { TemperaParams } from './pack';
import {
    TEMPERA_MAX_LAYER_IMAGES,
    type TemperaLayerImage,
    type TemperaTuning,
} from './temperaTuning';

const PACK_ID = 'tempera';

function LayerImagePool({ tuning, patchTuning }: Pick<PackSettingsProps<TemperaTuning, TemperaParams>, 'tuning' | 'patchTuning'>) {
    const images = tuning.layerImages;
    const assets = useProjectStore(state => state.project.assets);
    const library = assets.filter(item => item.kind === 'image');
    const available = library.filter(item => !images.some(image => image.id === item.id));
    const updateImage = (id: string, patch: Partial<TemperaLayerImage>) => patchTuning({
        layerImages: images.map(image => (image.id === id ? { ...image, ...patch } : image)),
    }, `image.${id}`);
    return (
        <>
            <div className="text-[11px] text-zinc-500">图片池：每个镜头按 seed 从这里取一张（立绘、logo、纹理）。图片存在「素材库」里，也可以手动摆到画面上。</div>
            {images.map(image => (
                <div key={image.id} className="space-y-1.5 rounded-md border border-zinc-800 p-2">
                    <div className="flex items-center justify-between gap-2 text-xs text-zinc-200">
                        <span className="truncate">{library.find(item => item.id === image.id)?.name ?? image.name}</span>
                        <button type="button" aria-label="移出图片池" title="移出图片池（素材库里保留）" onClick={() => setTemperaAuto(image.id, false)} className="text-zinc-500 hover:text-red-300">
                            <X size={13} />
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                        <select value={image.align} onChange={event => updateImage(image.id, { align: event.target.value as TemperaLayerImage['align'] })} className={inputClass}>
                            <option value="free">横向自由</option><option value="left">靠左</option><option value="center">居中</option><option value="right">靠右</option>
                        </select>
                        <select value={image.verticalAlign} onChange={event => updateImage(image.id, { verticalAlign: event.target.value as TemperaLayerImage['verticalAlign'] })} className={inputClass}>
                            <option value="free">纵向自由</option><option value="top">靠上</option><option value="center">居中</option><option value="bottom">靠下</option>
                        </select>
                    </div>
                    <Slider value={image.scale} min={0.1} max={1.5} step={0.01} onChange={scale => updateImage(image.id, { scale })} format={v => `高 ${Math.round(v * 100)}%`} />
                    <Slider value={image.opacity} min={0} max={1} step={0.01} onChange={opacity => updateImage(image.id, { opacity })} format={v => `${Math.round(v * 100)}%`} />
                </div>
            ))}
            {images.length < TEMPERA_MAX_LAYER_IMAGES && (
                <div className="grid grid-cols-2 gap-1.5">
                    <select
                        aria-label="从素材库加入图片池"
                        value=""
                        disabled={available.length === 0}
                        onChange={event => { if (event.target.value) setTemperaAuto(event.target.value, true); }}
                        className={inputClass}
                    >
                        <option value="">{available.length ? '从素材库加入…' : '素材库里没有别的图片'}</option>
                        {available.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <FileButton accept={IMAGE_ACCEPT} onFile={file => void importLibraryImage(file).then(asset => setTemperaAuto(asset.id, true))}>
                        <ImagePlus size={14} /> 上传
                    </FileButton>
                </div>
            )}
            {images.length > 0 && (
                <>
                    <Field label="出现频率">
                        <Slider value={tuning.layerImageFrequency} min={0} max={1} step={0.01} onChange={v => patchTuning({ layerImageFrequency: v }, 'layerImageFrequency')} format={v => `${Math.round(v * 100)}%`} />
                    </Field>
                    <Field label="层次">
                        <Segmented<'back' | 'front'>
                            value={tuning.layerImageDepth}
                            onChange={v => patchTuning({ layerImageDepth: v }, 'layerImageDepth')}
                            options={[{ value: 'back', label: '在歌词下（参与反色）' }, { value: 'front', label: '压在歌词上' }]}
                        />
                    </Field>
                </>
            )}
        </>
    );
}

export function TemperaSettings({ tuning, params, patchTuning, patchParams }: PackSettingsProps<TemperaTuning, TemperaParams>) {
    return (
        <>
            <Field label="配色" hint={tuning.colorMode === 'colorful' ? '每镜头自动选择协调渐变配色，可跳出主题色。' : undefined}>
                <Segmented<TemperaTuning['colorMode']>
                    value={tuning.colorMode}
                    onChange={colorMode => patchTuning({ colorMode }, 'colorMode')}
                    options={[{ value: 'duo', label: '双色' }, { value: 'mono', label: '单色' }, { value: 'gradient', label: '封面渐变' }, { value: 'colorful', label: '多彩' }]}
                />
            </Field>
            {tuning.colorMode !== 'mono' && (
                <Field label="色彩饱和度" hint={tuning.colorMode === 'colorful' ? '×2.5 为设计配色，调高略鲜艳，调低更素；×0 为灰度。背景和正文仍沿用主题，网点明暗层次不变。' : '×1 是凝彩原版的配色（偏灰），默认 ×2.5。调高让色块、网点与渐变更鲜艳，调低更素；明暗层次不变。主题自己的背景、正文与强调色不受影响。'}>
                    <Slider value={tuning.colorSaturation} min={0} max={3} step={0.05} onChange={v => patchTuning({ colorSaturation: v }, 'colorSaturation')} format={v => `×${v.toFixed(2)}`} />
                </Field>
            )}
            <Toggle label="整句一个镜头" checked={tuning.wholeLineLyrics} onChange={v => patchTuning({ wholeLineLyrics: v }, 'wholeLineLyrics')} />
            <Toggle label="文字动态反色" checked={tuning.textInversion} onChange={v => patchTuning({ textInversion: v }, 'textInversion')} />
            <Toggle label="大面积色块" checked={tuning.showBlocks} onChange={v => patchTuning({ showBlocks: v }, 'showBlocks')} />
            <Toggle label="网点装饰" checked={tuning.showDecor} onChange={v => patchTuning({ showDecor: v }, 'showDecor')} />
            <Toggle label="边角线框" checked={tuning.showCornerMarks} onChange={v => patchTuning({ showCornerMarks: v }, 'showCornerMarks')} />
            <Field label="逐字入场时序" hint="0：短促有力；1：整句铺满到歌词结束。">
                <Slider value={tuning.glyphSettleStretch} min={0} max={1} step={0.01} onChange={v => patchTuning({ glyphSettleStretch: v }, 'glyphSettleStretch')} format={v => v.toFixed(2)} />
            </Field>
            <Field label="镜头强度"><Slider value={tuning.cameraIntensity} min={0} max={2} step={0.01} onChange={v => patchTuning({ cameraIntensity: v }, 'cameraIntensity')} format={v => v.toFixed(2)} /></Field>
            <Field label="文字运动"><Slider value={tuning.glyphMotion} min={0} max={2} step={0.01} onChange={v => patchTuning({ glyphMotion: v }, 'glyphMotion')} format={v => v.toFixed(2)} /></Field>
            <LayerImagePool tuning={tuning} patchTuning={patchTuning} />
            <div className="pt-1 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">自动编排</div>
            <Field label="每镜头词数">
                <div className="grid grid-cols-2 gap-2">
                    <Slider value={params.chunkMinWords} min={1} max={6} step={1} onChange={v => patchParams({ chunkMinWords: v }, 'chunkMinWords')} format={v => `≥${v}`} />
                    <Slider value={params.chunkMaxWords} min={1} max={8} step={1} onChange={v => patchParams({ chunkMaxWords: v }, 'chunkMaxWords')} format={v => `≤${v}`} />
                </div>
            </Field>
            <Field label="每镜头最长秒数"><Slider value={params.chunkMaxSeconds} min={0.8} max={6} step={0.1} onChange={v => patchParams({ chunkMaxSeconds: v }, 'chunkMaxSeconds')} format={v => v.toFixed(1)} /></Field>
            <Field label="间奏镜头的最短空隙"><Slider value={params.bridgeMinGap} min={0.5} max={6} step={0.1} onChange={v => patchParams({ bridgeMinGap: v }, 'bridgeMinGap')} format={v => v.toFixed(1)} /></Field>
        </>
    );
}
