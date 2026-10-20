// Copyright (c) 2026 chthollyphile
// src/packs/lumiere/settings.tsx
// 绘光的设置面板（「画面与编排」侧栏里的绘光分组）。
import { Field, Segmented, Slider, Toggle } from '@/app/ui';
import type { PackSettingsProps } from '@/packs/contract';
import type { LumiereParams } from './program';
import type { LumiereTuning } from './types';

type Key = keyof LumiereTuning;

export function LumiereSettings({ tuning, params, patchTuning, patchParams }: PackSettingsProps<LumiereTuning, LumiereParams>) {
    const slider = (label: string, key: Key, min: number, max: number, step = 0.01) => (
        <Field label={label}>
            <Slider
                value={tuning[key] as number}
                min={min}
                max={max}
                step={step}
                onChange={v => patchTuning({ [key]: v } as Partial<LumiereTuning>, key)}
                format={v => (step >= 1 ? String(v) : v.toFixed(2))}
            />
        </Field>
    );
    const toggle = (label: string, key: Key) => (
        <Toggle label={label} checked={tuning[key] as boolean} onChange={v => patchTuning({ [key]: v } as Partial<LumiereTuning>, key)} />
    );
    return (
        <>
            {slider('光强', 'lightIntensity', 0, 2)}
            {slider('随音乐变亮', 'audioResponse', 0, 2)}
            {slider('烟雾浓度', 'fogDensity', 0, 2)}
            {slider('浮尘数量', 'moteAmount', 0, 2)}
            {slider('图形辉光', 'bloom', 0, 2)}
            {slider('文字辉光', 'textBloom', 0, 2)}
            {slider('未唱字透明度', 'unlitOpacity', 0, 0.6)}
            {slider('崩解强度', 'decay', 0, 2)}
            {slider('背景歌词', 'echo', 0, 2)}
            <Field label="邻行">
                <Segmented<'1' | '2'>
                    value={String(tuning.windowNeighbors) as '1' | '2'}
                    onChange={v => patchTuning({ windowNeighbors: Number(v) as 1 | 2 }, 'windowNeighbors')}
                    options={[{ value: '1', label: '上一行' }, { value: '2', label: '上一行 + 下一行' }]}
                />
            </Field>
            {toggle('所有换位都走轨迹线', 'trails')}
            <div>
                {toggle('轨迹过渡', 'seamlessTransitions')}
                <span className="mt-1 block text-[11px] text-zinc-500">
                    绘光段落之间也像段内换镜头一样在同一束光里交接（光束摆到新角度、线稿擦除重描、字沿轨迹飞到新位置），不再熄灯、闪白或拉焦。只换自动转场，手动指定的不变；单个段落也可以在出场转场里选「轨迹」。
                </span>
            </div>
            {toggle('线稿', 'lineArt')}
            {toggle('前景散景', 'frontBokeh')}
            {toggle('画框', 'overlayFrame')}
            {slider('主题色占比', 'themeColorMix', 0, 1)}
            {toggle('关键字着色', 'keywordColors')}
            {toggle('主题图标', 'themeIcons')}
            {slider('烟雾细节（画质）', 'fogOctaves', 2, 6, 1)}
            <div className="pt-1 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">自动编排</div>
            <Field label="每镜头最多行数"><Slider value={params.maxLinesPerShot} min={1} max={4} step={1} onChange={v => patchParams({ maxLinesPerShot: v }, 'maxLinesPerShot')} /></Field>
            <Field label="每镜头最长秒数"><Slider value={params.maxShotDuration} min={3} max={14} step={0.5} onChange={v => patchParams({ maxShotDuration: v }, 'maxShotDuration')} format={v => v.toFixed(1)} /></Field>
            <Field label="长行单独成镜（秒）"><Slider value={params.longLine} min={2} max={8} step={0.1} onChange={v => patchParams({ longLine: v }, 'longLine')} format={v => v.toFixed(1)} /></Field>
            <Field label="间奏镜头阈值（秒）"><Slider value={params.bridgeGap} min={2} max={10} step={0.5} onChange={v => patchParams({ bridgeGap: v }, 'bridgeGap')} format={v => v.toFixed(1)} /></Field>
        </>
    );
}
