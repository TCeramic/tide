// src/project/typography.ts
// 工程的字体设置（与 folia 的歌词 / 字幕字体设置相同的概念）：字体族列表（CSS font-family，按顺序回退）、
// 兜底的基础字体风格、字重、字号倍率；字幕默认继承歌词。与主题分开存，换主题（包括 AI 主题）不会冲掉。
// 渲染时套到主题上（fontStyle / fontFamilyStack / fontWeight），各包照旧经 resolveThemeFontStack 读取。
import type { Theme } from '@/core/types';
import { normalizeFontFamilyStack, normalizeFontWeight, resolveThemeFontStack } from '@/engine/shared/fontStacks';
import type { AssetRef } from './types';

export interface FontSettings {
    /** 兜底的内置字体栈。 */
    style: Theme['fontStyle'];
    /** 用户指定的字体族，排在兜底栈前面。 */
    families: string[];
    /** 100–900；null 表示按各包自己的字重规则。 */
    weight: number | null;
}

export interface ProjectTypography {
    lyrics: FontSettings & {
        /** 歌词字号倍率。 */
        scale: number;
    };
    subtitles: FontSettings & { inherit: boolean };
    /** 用户上传的字体文件：注册成 family 这个名字的 FontFace。 */
    fonts: Array<{ family: string; asset: AssetRef }>;
}

export const LYRICS_SCALE_RANGE = [0.6, 1.6] as const;

export const DEFAULT_TYPOGRAPHY: ProjectTypography = {
    lyrics: { style: 'sans', families: [], weight: null, scale: 1 },
    subtitles: { style: 'sans', families: [], weight: null, inherit: true },
    fonts: [],
};

const clampScale = (value: unknown) => (
    typeof value === 'number' && Number.isFinite(value)
        ? Math.min(LYRICS_SCALE_RANGE[1], Math.max(LYRICS_SCALE_RANGE[0], value))
        : 1
);

const normalizeStyle = (value: unknown): Theme['fontStyle'] => (value === 'serif' || value === 'mono' ? value : 'sans');

const normalizeFont = (raw: Partial<FontSettings> | undefined, fallback: FontSettings): FontSettings => ({
    style: normalizeStyle(raw?.style ?? fallback.style),
    families: normalizeFontFamilyStack(Array.isArray(raw?.families) ? raw.families : fallback.families),
    weight: raw?.weight === null ? null : normalizeFontWeight(raw?.weight) ?? fallback.weight,
});

/** 读旧工程：没有字体设置时从当时主题里的字体字段迁移过来。 */
export const normalizeTypography = (raw: Partial<ProjectTypography> | undefined, legacyTheme?: Theme): ProjectTypography => {
    const legacy: FontSettings = legacyTheme
        ? {
            style: normalizeStyle(legacyTheme.fontStyle),
            families: normalizeFontFamilyStack([legacyTheme.fontFamily, ...(legacyTheme.fontFamilyStack ?? [])]),
            weight: normalizeFontWeight(legacyTheme.fontWeight),
        }
        : DEFAULT_TYPOGRAPHY.lyrics;
    return {
        lyrics: { ...normalizeFont(raw?.lyrics, legacy), scale: clampScale(raw?.lyrics?.scale) },
        subtitles: { ...normalizeFont(raw?.subtitles, DEFAULT_TYPOGRAPHY.subtitles), inherit: raw?.subtitles?.inherit ?? true },
        fonts: Array.isArray(raw?.fonts) ? raw.fonts.filter(font => font?.family && font.asset?.id) : [],
    };
};

/** 把字体设置套到主题上（主题自带的字体字段被取代）。 */
export const withFont = (theme: Theme, font: FontSettings): Theme => ({
    ...theme,
    fontStyle: font.style,
    fontFamily: undefined,
    fontFamilyStack: font.families,
    fontWeight: font.weight ?? undefined,
});

export const subtitleFontOf = (typography: ProjectTypography): FontSettings => (
    typography.subtitles.inherit ? typography.lyrics : typography.subtitles
);

/** document.fonts.load 用的 CSS font 简写。 */
export const cssFontOf = (font: FontSettings, size = 48) => {
    const stack = resolveThemeFontStack({ fontStyle: font.style, fontFamilyStack: font.families });
    return `${font.weight ?? 400} ${size}px ${stack}`;
};
