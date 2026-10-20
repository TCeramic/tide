// src/app/wizard/coverTheme.ts
// 从封面取色得到一对深色 / 浅色主题：色相取自封面里最鲜艳、明度适中的颜色，
// 明度与饱和度按深 / 浅两种底色重新定，保证正文与背景的对比度（封面本身再暗、再灰也能读）。
import type { DualTheme, Theme } from '@/core/types';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '@/project/defaults';
import { t } from '@/i18n';
import { themeName } from './themeNames';

type Hsl = { h: number; s: number; l: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const hexToHsl = (hex: string): Hsl | null => {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) return null;
    const n = parseInt(match[1], 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s, l };
};

export const hslToHex = ({ h, s, l }: Hsl) => {
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return `#${[f(0), f(8), f(4)].map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;
};

/** WCAG 相对亮度与对比度（测试与挑色用）。 */
export const contrastRatio = (a: string, b: string) => {
    const lum = (hex: string) => {
        const n = parseInt(hex.slice(1), 16);
        const channel = (v: number) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
    };
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
};

/** 封面里「最能代表它」的颜色：鲜艳、又不太暗不太亮。 */
const vividness = ({ s, l }: Hsl) => s * (1 - Math.abs(l - 0.55) * 1.4);

export const themeFromCover = (colors: string[], base: DualTheme = { dark: DEFAULT_DARK_THEME, light: DEFAULT_LIGHT_THEME }): DualTheme | null => {
    const parsed = colors.map(hexToHsl).filter((value): value is Hsl => value !== null);
    if (parsed.length === 0) return null;
    const ranked = [...parsed].sort((a, b) => vividness(b) - vividness(a));
    const main = ranked[0];
    // 几乎是灰的封面：只取它的冷暖，饱和度压低，不硬造出不存在的颜色。
    const muted = main.s < 0.12;
    const hue = main.h;
    // 次要色：另一个色相差得足够远的颜色；没有就沿用主色相。
    const other = ranked.find(color => color.s >= 0.12 && Math.abs(((color.h - hue + 540) % 360) - 180) > 30);
    const secondHue = other?.h ?? hue;
    const accentSat = muted ? 0.08 : clamp(main.s, 0.45, 0.85);

    const dark: Theme = {
        ...base.dark,
        name: themeName(t('wizard:coverThemeName'), 'dark'),
        backgroundColor: hslToHex({ h: hue, s: muted ? 0.04 : clamp(main.s * 0.45, 0.08, 0.3), l: 0.07 }),
        primaryColor: hslToHex({ h: hue, s: muted ? 0.02 : 0.2, l: 0.93 }),
        accentColor: hslToHex({ h: hue, s: accentSat, l: muted ? 0.8 : clamp(main.l, 0.6, 0.7) }),
        secondaryColor: hslToHex({ h: secondHue, s: muted ? 0.04 : 0.25, l: 0.55 }),
        provider: 'Cover',
    };
    const light: Theme = {
        ...base.light,
        name: themeName(t('wizard:coverThemeName'), 'light'),
        backgroundColor: hslToHex({ h: hue, s: muted ? 0.04 : clamp(main.s * 0.5, 0.12, 0.35), l: 0.95 }),
        primaryColor: hslToHex({ h: hue, s: muted ? 0.04 : 0.3, l: 0.12 }),
        accentColor: hslToHex({ h: hue, s: accentSat, l: muted ? 0.3 : clamp(main.l, 0.36, 0.44) }),
        secondaryColor: hslToHex({ h: secondHue, s: muted ? 0.04 : 0.2, l: 0.35 }),
        provider: 'Cover',
    };
    return { dark, light };
};
