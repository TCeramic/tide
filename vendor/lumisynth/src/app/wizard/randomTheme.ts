// src/app/wizard/randomTheme.ts
// 随机配色（骰子）：随机取一个色相与一种配色关系（邻近 / 互补 / 分裂互补 / 三色），
// 按深 / 浅两种底色定明度与饱和度，再核对对比度——正文对背景至少 7:1，强调色至少 4.5:1，次要色至少 3:1，
// 不够就把明度往远离背景的方向推。关键字颜色、歌词图标来自歌词，沿用传进来的主题。
import type { DualTheme, Theme } from '@/core/types';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '@/project/defaults';
import { contrastRatio, hslToHex } from './coverTheme';
import { t } from '@/i18n';
import { themeName } from './themeNames';

type Random = () => number;

const HARMONIES = [
    { name: 'analogous', offsets: [30, -30] },
    { name: 'complementary', offsets: [180, 180] },
    { name: 'split', offsets: [150, 210] },
    { name: 'triad', offsets: [120, 240] },
] as const;

const HUE_NAMES = [
    [15, 'vermilion'], [40, 'orange'], [55, 'amber'], [70, 'gold'], [95, 'lime'], [140, 'green'], [170, 'emerald'],
    [195, 'cyan'], [215, 'sky'], [245, 'blue'], [270, 'indigo'], [295, 'purple'], [325, 'magenta'], [350, 'rose'], [360, 'vermilion'],
] as const;

export const hueName = (hue: number) => t(`wizard:random.hues.${HUE_NAMES.find(([limit]) => ((hue % 360) + 360) % 360 < limit)?.[1] ?? 'vermilion'}`);


const between = (random: Random, min: number, max: number) => min + random() * (max - min);
const wrap = (hue: number) => ((hue % 360) + 360) % 360;

/** 明度往远离背景的方向推，直到对比度够（最多推到头）。 */
const readable = (h: number, s: number, l: number, background: string, ratio: number, dark: boolean) => {
    let lightness = l;
    for (let i = 0; i < 40; i += 1) {
        const color = hslToHex({ h, s, l: lightness });
        if (contrastRatio(color, background) >= ratio) return color;
        lightness = dark ? Math.min(0.98, lightness + 0.02) : Math.max(0.02, lightness - 0.02);
    }
    return hslToHex({ h, s, l: lightness });
};

export const randomTheme = (current: DualTheme = { dark: DEFAULT_DARK_THEME, light: DEFAULT_LIGHT_THEME }, random: Random = Math.random): DualTheme => {
    const hue = random() * 360;
    const harmony = HARMONIES[Math.floor(random() * HARMONIES.length)];
    const accentHue = wrap(hue + harmony.offsets[0] * (random() < 0.5 ? 0.5 : 1));
    const secondHue = wrap(hue + harmony.offsets[1]);
    const vivid = between(random, 0.55, 0.9);
    const tint = between(random, 0.1, 0.35);
    const label = t('wizard:random.label', { hue: hueName(hue), harmony: t(`wizard:random.harmonies.${harmony.name}`) });
    const shared = { wordColors: current.dark.wordColors, lyricsIcons: current.dark.lyricsIcons };

    const darkBackground = hslToHex({ h: hue, s: tint, l: between(random, 0.05, 0.1) });
    const dark: Theme = {
        ...current.dark,
        ...shared,
        name: themeName(label, 'dark'),
        backgroundColor: darkBackground,
        primaryColor: readable(hue, between(random, 0.05, 0.25), 0.92, darkBackground, 7, true),
        accentColor: readable(accentHue, vivid, between(random, 0.58, 0.7), darkBackground, 4.5, true),
        secondaryColor: readable(secondHue, between(random, 0.2, 0.45), 0.55, darkBackground, 3, true),
        provider: 'Random',
    };
    const lightBackground = hslToHex({ h: hue, s: tint, l: between(random, 0.93, 0.97) });
    const light: Theme = {
        ...current.light,
        ...shared,
        name: themeName(label, 'light'),
        backgroundColor: lightBackground,
        primaryColor: readable(hue, between(random, 0.15, 0.35), 0.13, lightBackground, 7, false),
        accentColor: readable(accentHue, vivid, between(random, 0.36, 0.45), lightBackground, 4.5, false),
        secondaryColor: readable(secondHue, between(random, 0.15, 0.35), 0.38, lightBackground, 3, false),
        provider: 'Random',
    };
    // 描述是写给原来那套配色的，随机出来的不带。
    delete dark.description;
    delete light.description;
    return { dark, light };
};
