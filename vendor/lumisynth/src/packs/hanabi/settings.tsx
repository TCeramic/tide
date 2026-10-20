// src/packs/hanabi/settings.tsx
// 花火的设置面板（「画面与编排」侧栏里的花火分组）。
import { Field, Segmented, Slider, Toggle } from '@/app/ui';
import type { PackSettingsProps } from '@/packs/contract';
import type { HanabiParams } from './program';
import type { HanabiTuning } from './types';

type Key = keyof HanabiTuning;

export function HanabiSettings({ tuning, params, patchTuning, patchParams }: PackSettingsProps<HanabiTuning, HanabiParams>) {
    const slider = (label: string, key: Key, min: number, max: number, step = 0.01) => (
        <Field label={label}>
            <Slider
                value={tuning[key] as number}
                min={min}
                max={max}
                step={step}
                onChange={v => patchTuning({ [key]: v } as Partial<HanabiTuning>, key)}
                format={v => v.toFixed(2)}
            />
        </Field>
    );
    const toggle = (label: string, key: Key) => (
        <Toggle label={label} checked={tuning[key] as boolean} onChange={v => patchTuning({ [key]: v } as Partial<HanabiTuning>, key)} />
    );
    return (
        <>
            <Field label="配色">
                <Segmented<HanabiTuning['colorMode']>
                    value={tuning.colorMode}
                    onChange={v => patchTuning({ colorMode: v }, 'colorMode')}
                    options={[{ value: 'theme', label: '跟随主题' }, { value: 'mixed', label: '混合' }, { value: 'vivid', label: '鲜艳' }]}
                />
            </Field>
            {slider('烟花粒子', 'sparkAmount', 0, 2)}
            {slider('装饰件数量', 'ornamentAmount', 0, 2)}
            {slider('文字动作幅度', 'textMotion', 0, 2)}
            {slider('色块不透明度', 'blockOpacity', 0, 1)}
            {slider('上升速度', 'riseSpeed', 0, 2)}
            {slider('环境粒子', 'ambient', 0, 2)}
            {slider('辉光', 'glow', 0, 2)}
            {toggle('升空尾迹', 'launches')}
            {toggle('画框', 'overlayFrame')}
            <div className="pt-1 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">自动编排</div>
            <Field label="长行切分字数"><Slider value={params.maxChars} min={8} max={40} step={1} onChange={v => patchParams({ maxChars: v }, 'maxChars')} /></Field>
            <Field label="长行切分秒数"><Slider value={params.maxLineSeconds} min={2} max={15} step={0.5} onChange={v => patchParams({ maxLineSeconds: v }, 'maxLineSeconds')} format={v => v.toFixed(1)} /></Field>
            <Field label="间奏镜头阈值（秒）"><Slider value={params.bridgeGap} min={1} max={12} step={0.5} onChange={v => patchParams({ bridgeGap: v }, 'bridgeGap')} format={v => v.toFixed(1)} /></Field>
        </>
    );
}
