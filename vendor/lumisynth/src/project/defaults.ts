import type { Theme } from '@/core/types';
import { migrateLegacyLayerImages } from './assets';
import { DEFAULT_TYPOGRAPHY, normalizeTypography, subtitleFontOf, withFont, type ProjectTypography } from './typography';
import { EMPTY_LYRIC_EDITS } from '@/core/lyrics/edits';
import { DEFAULT_DIRECTION_SETTINGS, mixOverrides } from '@/compiler/types';
import { DEFAULT_ENGINE_PARAMS, normalizeEngineParams } from '@/compiler/params';
import { DEFAULT_KERNEL_TUNING } from '@/kernel/tuning';
import type { PackId } from '@/packs/contract';
import { findPack, listPacks } from '@/packs/registry';
import { PROJECT_VERSION, type LumiProject } from './types';
import { t } from '@/i18n';

// folia 的内置默认主题「午夜墨染」与「日光素白」。
export const DEFAULT_DARK_THEME: Theme = {
    name: 'Midnight Default',
    backgroundColor: '#09090b',
    primaryColor: '#f4f4f5',
    accentColor: '#f4f4f5',
    secondaryColor: '#71717a',
    fontStyle: 'sans',
    animationIntensity: 'normal',
};

export const DEFAULT_LIGHT_THEME: Theme = {
    name: 'Daylight Default',
    backgroundColor: '#f5f5f4',
    primaryColor: '#1c1917',
    accentColor: '#ea580c',
    secondaryColor: '#44403c',
    fontStyle: 'sans',
    animationIntensity: 'normal',
};

export const newId = () => (
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
);

export const createProject = (name = t('project:untitled')): LumiProject => {
    const now = Date.now();
    return {
        version: PROJECT_VERSION,
        id: newId(),
        name,
        createdAt: now,
        updatedAt: now,
        audio: null,
        cover: null,
        lyrics: null,
        translation: null,
        meta: { title: '', artist: '', album: '' },
        lyricEdits: EMPTY_LYRIC_EDITS,
        theme: { source: 'preset', dual: { light: DEFAULT_LIGHT_THEME, dark: DEFAULT_DARK_THEME }, variant: 'dark' },
        seed: newId().slice(0, 8),
        aspect: '16:9',
        direction: DEFAULT_DIRECTION_SETTINGS,
        engineParams: DEFAULT_ENGINE_PARAMS,
        paragraphDirections: [],
        overrides: [],
        structureEdits: [],
        library: { favorites: [], blocked: [] },
        tuning: {
            kernel: DEFAULT_KERNEL_TUNING,
            packs: Object.fromEntries(listPacks().map(pack => [pack.id, pack.tuning.defaults])),
        },
        assets: [],
        assetClips: [],
        backgroundClips: [],
        typography: DEFAULT_TYPOGRAPHY,
    };
};

/**
 * 每个已注册的包经自己的 normalize 补齐；没装的包的 tuning 原样保留（装上之后还能用）。
 * 旧版工程把 tuning 直接放在 `tuning.sonnet` / `tuning.tempera` 上，这里迁到 packs 里。
 */
const normalizePackTunings = (raw: unknown): Record<PackId, unknown> => {
    const source = (raw ?? {}) as { packs?: Record<PackId, unknown> } & Record<string, unknown>;
    const packs: Record<PackId, unknown> = { ...(source.packs ?? {}) };
    for (const legacy of ['tempera', 'sonnet']) {
        if (source[legacy] && packs[legacy] === undefined) packs[legacy] = source[legacy];
    }
    listPacks().forEach(pack => {
        packs[pack.id] = pack.tuning.normalize(packs[pack.id]);
    });
    return packs;
};

/** 工程里某个包的 tuning（补齐缺省字段）。 */
export const packTuningOf = <T>(project: LumiProject, id: PackId): T => {
    const pack = findPack(id);
    return (pack ? pack.tuning.normalize(project.tuning.packs[id]) : project.tuning.packs[id]) as T;
};

/**
 * 读进来的工程（IndexedDB 或 .lumi）可能来自旧版本或缺字段；以默认值为底逐层补齐，
 * 保证后续代码不用到处判空。
 */
export const normalizeProject = (raw: Partial<LumiProject>): LumiProject => {
    const base = createProject(raw.name);
    return {
        ...base,
        ...raw,
        version: PROJECT_VERSION,
        meta: { ...base.meta, ...raw.meta },
        lyricEdits: { ...base.lyricEdits, ...raw.lyricEdits },
        theme: { ...base.theme, ...raw.theme },
        direction: {
            ...base.direction,
            ...raw.direction,
            mixByKind: mixOverrides(raw.direction?.mixByKind ?? {}),
        },
        engineParams: normalizeEngineParams(raw.engineParams),
        library: { ...base.library, ...raw.library },
        tuning: {
            packs: normalizePackTunings(raw.tuning),
            kernel: {
                ...base.tuning.kernel,
                ...raw.tuning?.kernel,
                background: { ...base.tuning.kernel.background, ...raw.tuning?.kernel?.background },
                postProcess: { ...base.tuning.kernel.postProcess, ...raw.tuning?.kernel?.postProcess },
                subtitles: { ...base.tuning.kernel.subtitles, ...raw.tuning?.kernel?.subtitles },
                motion: { ...base.tuning.kernel.motion, ...raw.tuning?.kernel?.motion },
            },
        },
        paragraphDirections: raw.paragraphDirections ?? [],
        overrides: raw.overrides ?? [],
        structureEdits: raw.structureEdits ?? [],
        assets: migrateLegacyLayerImages(raw as never),
        // 旧字段：迁进素材库后不再保留。
        ...({ layerImageAssets: undefined } as object),
        assetClips: raw.assetClips ?? [],
        backgroundClips: raw.backgroundClips ?? [],
        typography: normalizeTypography(raw.typography, raw.typography ? undefined : raw.theme?.dual?.[raw.theme.variant ?? 'dark']),
    };
};

export const activeTheme = (project: LumiProject): Theme => project.theme.dual[project.theme.variant];

/** 渲染用的主题：当前主题 + 工程的歌词字体设置。 */
export const renderTheme = (project: LumiProject, typography: ProjectTypography = project.typography): Theme => (
    withFont(activeTheme(project), typography.lyrics)
);

/** 交给内核的字体相关部分：套上字体的主题、歌词字号倍率、字幕主题。 */
export const renderFonts = (project: LumiProject, typography: ProjectTypography = project.typography) => {
    const theme = activeTheme(project);
    return {
        theme: withFont(theme, typography.lyrics),
        lyricsFontScale: typography.lyrics.scale,
        subtitleTheme: withFont(theme, subtitleFontOf(typography)),
    };
};
