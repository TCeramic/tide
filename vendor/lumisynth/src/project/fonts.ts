// src/project/fonts.ts
// 用户上传的字体文件：存进 IndexedDB（进 .lumi），打开工程时注册成 FontFace；
// 以及本机字体列表（Local Font Access API，只有 Chromium 支持，需要用户授权）。
import { newId } from './defaults';
import { getAssetBlob, putAsset } from './db';
import { updateProject } from './store';
import type { ProjectTypography } from './typography';
import { t } from '@/i18n';

const registered = new Map<string, FontFace>();

const hasFontApi = () => typeof FontFace !== 'undefined' && typeof document !== 'undefined' && Boolean(document.fonts);

const register = async (family: string, source: ArrayBuffer, key: string) => {
    if (!hasFontApi() || registered.has(key)) return;
    const face = new FontFace(family, source);
    await face.load();
    document.fonts.add(face);
    registered.set(key, face);
};

/** 打开工程时：把上传过的字体都注册上（已注册的跳过）。 */
export const registerProjectFonts = async (fonts: ProjectTypography['fonts']) => {
    await Promise.all(fonts.map(async font => {
        const key = `${font.family}|${font.asset.id}`;
        if (registered.has(key)) return;
        const blob = await getAssetBlob(font.asset.id);
        if (!blob) return;
        try {
            await register(font.family, await blob.arrayBuffer(), key);
        } catch (error) {
            console.warn(`[lumisynth] 字体 ${font.family} 注册失败`, error);
        }
    }));
};

export const FONT_FILE_ACCEPT = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';

/** 上传一个字体文件：注册、存进工程，并放到歌词字体族的最前面。返回字体族名。 */
export const importFontFile = async (file: File): Promise<string> => {
    const base = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').trim() || t('project:fonts.uploaded');
    // 用独立的名字注册，免得和系统里同名的字体（字重不全的那份）混在一起。
    const family = `${base} (lumisynth-${newId().slice(0, 4)})`;
    const buffer = await file.arrayBuffer();
    let face: FontFace | null = null;
    if (hasFontApi()) {
        try {
            face = new FontFace(family, buffer);
            await face.load();
        } catch {
            throw new Error(t('project:fonts.unreadable', { name: file.name }));
        }
    }
    const asset = await putAsset(file, file.name);
    if (face) {
        document.fonts.add(face);
        registered.set(`${family}|${asset.id}`, face);
    }
    updateProject(project => ({
        ...project,
        typography: {
            ...project.typography,
            fonts: [...project.typography.fonts, { family, asset }],
            lyrics: { ...project.typography.lyrics, families: [family, ...project.typography.lyrics.families] },
        },
    }));
    return family;
};

export const removeUploadedFont = (family: string) => updateProject(project => ({
    ...project,
    typography: {
        ...project.typography,
        fonts: project.typography.fonts.filter(font => font.family !== family),
        lyrics: { ...project.typography.lyrics, families: project.typography.lyrics.families.filter(item => item !== family) },
        subtitles: { ...project.typography.subtitles, families: project.typography.subtitles.families.filter(item => item !== family) },
    },
}));

// ---------------------------------------------------------------------------------------------
// 本机字体

interface LocalFontData {
    family: string;
}

export const supportsLocalFonts = () => typeof window !== 'undefined'
    && typeof (window as Window & { queryLocalFonts?: unknown }).queryLocalFonts === 'function';

/** 列出本机字体族（去重、排序）。浏览器会先询问用户是否允许。 */
export const listLocalFontFamilies = async (): Promise<string[]> => {
    const query = (window as Window & { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
    if (!query) throw new Error(t('project:fonts.noLocalFonts'));
    const fonts = await query();
    return [...new Set(fonts.map(font => font.family))].sort((a, b) => a.localeCompare(b));
};
