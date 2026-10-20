// src/project/assets.ts
// 素材库（工程级，图片；M20 起也有背景视频）与素材片段的编辑动作。
// 凝彩原来的图片池是素材库的一部分：凝彩的 tuning.layerImages 按素材 id 引用库里的图片，
// 「允许凝彩自动取用」就是把它放进 / 移出那个列表。
import type { AssetClip, ClipTiming } from '@/core/assets/clips';
import { DEFAULT_CLIP_LOOK } from '@/core/assets/clips';
import { DEFAULT_BACKGROUND_LOOK, type BackgroundClip, type BackgroundSource } from '@/core/assets/background';
import { DEFAULT_TEMPERA_LAYER_IMAGE, type TemperaTuning } from '@/packs/tempera/temperaTuning';
import { newId } from './defaults';
import { putAsset } from './db';
import { setSession, useSession } from './session';
import { updateProject } from './store';
import type { AssetRef, LumiProject } from './types';
import { t } from '@/i18n';

export interface LibraryAsset {
    id: string;
    name: string;
    kind: 'image' | 'video';
    asset: AssetRef;
    width: number;
    height: number;
    /** 视频的时长（秒）。 */
    duration?: number;
}

const TEMPERA = 'tempera';

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

const measureImage = async (blob: Blob) => {
    try {
        const bitmap = await createImageBitmap(blob);
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
    } catch {
        throw new Error(t('project:assets.unreadableImage'));
    }
};

/** 导入一张图片到素材库（存 IndexedDB，进 .lumi）。 */
export const importLibraryImage = async (file: File): Promise<LibraryAsset> => {
    const { width, height } = await measureImage(file);
    const id = newId();
    const ref = await putAsset(file, file.name);
    const asset: LibraryAsset = { id, name: file.name, kind: 'image', asset: ref, width, height };
    const blobs = new Map(useSession.getState().assetBlobs);
    blobs.set(id, file);
    setSession({ assetBlobs: blobs });
    updateProject(project => ({ ...project, assets: [...project.assets, asset] }));
    return asset;
};

export const renameLibraryAsset = (id: string, name: string) => updateProject(project => ({
    ...project,
    assets: project.assets.map(item => (item.id === id ? { ...item, name } : item)),
}), { coalesce: `asset-name:${id}` });

/** 从素材库删除：用到它的片段与凝彩图片池里的引用一起删掉。 */
export const removeLibraryAsset = (id: string) => updateProject(project => {
    const tempera = project.tuning.packs[TEMPERA] as TemperaTuning | undefined;
    return {
        ...project,
        assets: project.assets.filter(item => item.id !== id),
        assetClips: project.assetClips.filter(clip => clip.assetId !== id),
        backgroundClips: project.backgroundClips.filter(clip => !('assetId' in clip.source) || clip.source.assetId !== id),
        tuning: tempera
            ? { ...project.tuning, packs: { ...project.tuning.packs, [TEMPERA]: { ...tempera, layerImages: tempera.layerImages.filter(image => image.id !== id) } } }
            : project.tuning,
    };
});

export const isInTemperaPool = (project: LumiProject, id: string) => (
    ((project.tuning.packs[TEMPERA] as TemperaTuning | undefined)?.layerImages ?? []).some(image => image.id === id)
);

export const setTemperaAuto = (id: string, enabled: boolean) => updateProject(project => {
    const tempera = project.tuning.packs[TEMPERA] as TemperaTuning | undefined;
    const asset = project.assets.find(item => item.id === id);
    if (!tempera || !asset || asset.kind !== 'image') return project;
    const others = tempera.layerImages.filter(image => image.id !== id);
    const layerImages = enabled ? [...others, { id, name: asset.name, ...DEFAULT_TEMPERA_LAYER_IMAGE }] : others;
    return { ...project, tuning: { ...project.tuning, packs: { ...project.tuning.packs, [TEMPERA]: { ...tempera, layerImages } } } };
});

// ---------------------------------------------------------------------------------------------
// 片段

export const addAssetClip = (assetId: string, timing: ClipTiming, patch: Partial<AssetClip> = {}) => {
    const clip: AssetClip = { id: newId(), assetId, timing, ...DEFAULT_CLIP_LOOK, ...patch };
    updateProject(project => ({ ...project, assetClips: [...project.assetClips, clip] }));
    return clip;
};

export const updateAssetClip = (id: string, patch: Partial<AssetClip>, coalesce?: string) => updateProject(project => ({
    ...project,
    assetClips: project.assetClips.map(clip => (clip.id === id ? { ...clip, ...patch } : clip)),
}), coalesce ? { coalesce: `clip:${id}:${coalesce}` } : undefined);

export const removeAssetClip = (id: string) => updateProject(project => ({
    ...project,
    assetClips: project.assetClips.filter(clip => clip.id !== id),
}));

export const duplicateAssetClip = (id: string) => {
    let copy: AssetClip | null = null;
    updateProject(project => {
        const source = project.assetClips.find(clip => clip.id === id);
        if (!source) return project;
        copy = { ...source, id: newId(), x: Math.min(0.95, source.x + 0.04), y: Math.min(0.95, source.y + 0.04) };
        return { ...project, assetClips: [...project.assetClips, copy] };
    });
    return copy as AssetClip | null;
};

/** 读旧工程：凝彩的图片池（layerImageAssets）迁进素材库，id 不变。 */
export const migrateLegacyLayerImages = (raw: { layerImageAssets?: Record<string, AssetRef>; assets?: LibraryAsset[] }): LibraryAsset[] => {
    const existing = raw.assets ?? [];
    const legacy = Object.entries(raw.layerImageAssets ?? {})
        .filter(([id]) => !existing.some(item => item.id === id))
        .map(([id, ref]): LibraryAsset => ({ id, name: ref.name, kind: 'image', asset: ref, width: 0, height: 0 }));
    return [...existing, ...legacy];
};

// ---------------------------------------------------------------------------------------------
// 视频（只能用作背景）

export const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime';

const measureVideo = (blob: Blob) => new Promise<{ width: number; height: number; duration: number }>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
        resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
        URL.revokeObjectURL(url);
    };
    video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(t('project:assets.unplayableVideo')));
    };
    video.src = url;
});

/** 导入一段视频到素材库（只能用作背景）。 */
export const importLibraryVideo = async (file: File): Promise<LibraryAsset> => {
    const { width, height, duration } = await measureVideo(file);
    const id = newId();
    const ref = await putAsset(file, file.name);
    const asset: LibraryAsset = { id, name: file.name, kind: 'video', asset: ref, width, height, duration };
    const blobs = new Map(useSession.getState().assetBlobs);
    blobs.set(id, file);
    setSession({ assetBlobs: blobs });
    updateProject(project => ({ ...project, assets: [...project.assets, asset] }));
    return asset;
};

export const importLibraryFile = (file: File) => (file.type.startsWith('video/') ? importLibraryVideo(file) : importLibraryImage(file));

// ---------------------------------------------------------------------------------------------
// 背景轨

export const addBackgroundClip = (source: BackgroundSource, timing: ClipTiming, patch: Partial<BackgroundClip> = {}) => {
    const clip: BackgroundClip = { id: newId(), source, timing, ...DEFAULT_BACKGROUND_LOOK, ...patch };
    updateProject(project => ({ ...project, backgroundClips: [...project.backgroundClips, clip] }));
    return clip;
};

export const updateBackgroundClip = (id: string, patch: Partial<BackgroundClip>, coalesce?: string) => updateProject(project => ({
    ...project,
    backgroundClips: project.backgroundClips.map(clip => (clip.id === id ? { ...clip, ...patch } : clip)),
}), coalesce ? { coalesce: `background:${id}:${coalesce}` } : undefined);

export const removeBackgroundClip = (id: string) => updateProject(project => ({
    ...project,
    backgroundClips: project.backgroundClips.filter(clip => clip.id !== id),
}));

/** 背景片段的叠放顺序：后面的盖住前面的。 */
export const moveBackgroundClip = (id: string, direction: -1 | 1) => updateProject(project => {
    const index = project.backgroundClips.findIndex(clip => clip.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= project.backgroundClips.length) return project;
    const next = [...project.backgroundClips];
    [next[index], next[target]] = [next[target], next[index]];
    return { ...project, backgroundClips: next };
});
