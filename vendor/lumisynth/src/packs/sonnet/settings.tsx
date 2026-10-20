// src/packs/sonnet/settings.tsx
// 商籁的设置面板。
import { Field, Segmented, Slider, Toggle } from '@/app/ui';
import type { PackSettingsProps } from '@/packs/contract';
import type { SonnetParams } from './pack';
import type { SonnetTuning } from './sonnetTuning';

export function SonnetSettings({ tuning, params, patchTuning, patchParams }: PackSettingsProps<SonnetTuning, SonnetParams>) {
    return (
        <>
            <Toggle label="引导线" checked={tuning.showGuide} onChange={v => patchTuning({ showGuide: v }, 'showGuide')} />
            <Toggle label="背景图形" checked={tuning.showBackgroundMg} onChange={v => patchTuning({ showBackgroundMg: v }, 'showBackgroundMg')} />
            <Toggle label="文字浮标" checked={tuning.showFixedGeo} onChange={v => patchTuning({ showFixedGeo: v }, 'showFixedGeo')} />
            <Toggle label="巨型装饰字" checked={tuning.showGiantDecorativeText} onChange={v => patchTuning({ showGiantDecorativeText: v }, 'showGiantDecorativeText')} />
            <Toggle label="背景图标" checked={tuning.showBackgroundDecor} onChange={v => patchTuning({ showBackgroundDecor: v }, 'showBackgroundDecor')} />
            <Toggle label="只显示文字" checked={tuning.showOnlyText} onChange={v => patchTuning({ showOnlyText: v }, 'showOnlyText')} />
            <Field label="外框">
                <Segmented<SonnetTuning['outerFrameMode']>
                    value={tuning.outerFrameMode}
                    onChange={v => patchTuning({ outerFrameMode: v }, 'outerFrameMode')}
                    options={[{ value: 'none', label: '无' }, { value: 'frame', label: '框' }, { value: 'full', label: '完整' }]}
                />
            </Field>
            <Field label="图形密度"><Slider value={tuning.mgDensity} min={0} max={2} step={0.01} onChange={v => patchTuning({ mgDensity: v }, 'mgDensity')} format={v => v.toFixed(2)} /></Field>
            <Field label="镜头强度"><Slider value={tuning.cameraIntensity} min={0} max={2} step={0.01} onChange={v => patchTuning({ cameraIntensity: v }, 'cameraIntensity')} format={v => v.toFixed(2)} /></Field>
            <Field label="文字运动"><Slider value={tuning.typographyMotion} min={0} max={2} step={0.01} onChange={v => patchTuning({ typographyMotion: v }, 'typographyMotion')} format={v => v.toFixed(2)} /></Field>
            <div className="pt-1 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">自动编排</div>
            <Field label="每镜头最多行数"><Slider value={params.groupMaxLines} min={1} max={6} step={1} onChange={v => patchParams({ groupMaxLines: v }, 'groupMaxLines')} /></Field>
            <Field label="每镜头最长秒数"><Slider value={params.groupMaxSeconds} min={2} max={12} step={0.5} onChange={v => patchParams({ groupMaxSeconds: v }, 'groupMaxSeconds')} format={v => v.toFixed(1)} /></Field>
        </>
    );
}
