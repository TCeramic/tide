// src/project/actions.ts
// 牵涉文件、IndexedDB、解码的异步操作。组件只调这些函数，不直接碰 db / 解码。
import { registerProjectFonts } from './fonts';
import { analyzeAudioBuffer, decodeAudioBlob } from '@/core/audio/decode';
import { readAudioMetadata } from '@/core/media/metadata';
import { extractRepresentativeColors } from '@/engine/shared/colorExtractor';
import { createProject, newId, normalizeProject } from './defaults';
import { packProject, unpackProject, LUMI_EXTENSION } from './archive';
import { collectGarbageAssets, getAssetBlob, listProjects, loadProjectRow, putAsset, saveProjectRow } from './db';
import { log } from '@/app/output';
import { replaceObjectUrl, setSession, useSession } from './session';
import { getProject, updateProject, useProjectStore } from './store';
import type { AssetRef, LumiProject } from './types';
import { resources, t } from '@/i18n';

const LAST_PROJECT_KEY = 'lumisynth:last-project';

const safeLocalStorage = {
    get: (key: string) => {
        try { return localStorage.getItem(key); } catch { return null; }
    },
    set: (key: string, value: string) => {
        try { localStorage.setItem(key, value); } catch { /* 隐私模式等 */ }
    },
};

/** 还是默认名字（任何一种界面语言下建的）：导入音频时用歌名替换。 */
const isUntitled = (name: string) => Object.values(resources).some(dictionary => dictionary.project.untitled === name);

const reportError = (prefix: string, error: unknown) => {
    const message = t('project:errorWithReason', { prefix, message: error instanceof Error ? error.message : String(error) });
    console.error(message, error);
    log(message, 'error');
    setSession({ error: message, status: null });
};

// ---------------------------------------------------------------------------------------------
// 会话资源：从工程里的 AssetRef 重新加载

let audioLoadToken = 0;

const loadAudioIntoSession = async (blob: Blob | null) => {
    const token = ++audioLoadToken;
    replaceObjectUrl('audioUrl', blob);
    setSession({ audioBuffer: null, analysis: null, analysisProgress: blob ? 0 : null });
    if (!blob) return;
    try {
        setSession({ status: t('project:status.decoding') });
        const buffer = await decodeAudioBlob(blob);
        if (token !== audioLoadToken) return;
        setSession({ audioBuffer: buffer, status: t('project:status.analyzing') });
        const analysis = await analyzeAudioBuffer(buffer, progress => {
            if (token === audioLoadToken) setSession({ analysisProgress: progress });
        });
        if (token !== audioLoadToken) return;
        setSession({ analysis, analysisProgress: null, status: null });
        log(t('project:analyzed', { duration: buffer.duration.toFixed(1), count: buffer.numberOfChannels }));
    } catch (error) {
        if (token === audioLoadToken) {
            setSession({ analysisProgress: null });
            reportError(t('project:errors.decode'), error);
        }
    }
};

const loadCoverIntoSession = async (blob: Blob | null) => {
    const url = replaceObjectUrl('coverUrl', blob);
    setSession({ coverColors: [], coverBlob: blob });
    if (!url) return;
    try {
        const colors = await extractRepresentativeColors(url, 5);
        if (useSession.getState().coverUrl === url) setSession({ coverColors: colors });
    } catch {
        // 取色失败只影响 gradient 色彩模式与封面背景的配色。
    }
};

const loadLayerImagesIntoSession = async (project: LumiProject) => {
    const entries = await Promise.all(project.assets.map(async item => (
        [item.id, await getAssetBlob(item.asset.id)] as const
    )));
    setSession({ assetBlobs: new Map(entries.filter((entry): entry is [string, Blob] => entry[1] !== null)) });
};

const hydrateSession = async (project: LumiProject) => {
    setSession({ selection: { type: 'none' }, error: null });
    await Promise.all([
        loadAudioIntoSession(project.audio ? await getAssetBlob(project.audio.id) : null),
        loadCoverIntoSession(project.cover ? await getAssetBlob(project.cover.id) : null),
        loadLayerImagesIntoSession(project),
        registerProjectFonts(project.typography.fonts),
    ]);
};

// ---------------------------------------------------------------------------------------------
// 工程生命周期

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let autosaveStarted = false;

/** 工程有变化就延迟写回 IndexedDB。只需在应用启动时调一次。 */
export const startAutosave = () => {
    if (autosaveStarted) return;
    autosaveStarted = true;
    useProjectStore.subscribe((state, previous) => {
        if (state.project === previous.project) return;
        if (autosaveTimer) clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
            void saveProjectRow(useProjectStore.getState().project).catch(error => reportError(t('project:errors.save'), error));
        }, 600);
    });
};

export const flushAutosave = async () => {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = null;
    await saveProjectRow(getProject());
};

const openProjectObject = async (project: LumiProject) => {
    log(t('project:opened', { name: project.name }));
    useProjectStore.getState().replace(project);
    safeLocalStorage.set(LAST_PROJECT_KEY, project.id);
    await saveProjectRow(project);
    await hydrateSession(project);
};

/** 启动时打开上次的工程；没有就新建一个。 */
export const bootstrapProject = async () => {
    startAutosave();
    const lastId = safeLocalStorage.get(LAST_PROJECT_KEY);
    const stored = lastId ? await loadProjectRow(lastId).catch(() => null) : null;
    await openProjectObject(stored ? normalizeProject(stored) : createProject());
};

export const newProject = async () => {
    await flushAutosave();
    await openProjectObject(createProject());
};

export const openProject = async (id: string) => {
    await flushAutosave();
    const stored = await loadProjectRow(id);
    if (stored) await openProjectObject(normalizeProject(stored));
};

export { listProjects };

export const exportProjectFile = async (): Promise<{ blob: Blob; fileName: string }> => {
    await flushAutosave();
    const project = getProject();
    const blob = await packProject(project, getAssetBlob);
    const safeName = project.name.replace(/[\\/:*?"<>|]+/g, '_') || 'project';
    return { blob, fileName: `${safeName}.${LUMI_EXTENSION}` };
};

export const importProjectFile = async (file: Blob) => {
    try {
        await flushAutosave();
        const { project, assets } = await unpackProject(file);
        await Promise.all(assets.map(({ ref, blob }) => putAsset(blob, ref.name, ref.id)));
        // 导入的是副本：换一个 id，不覆盖本机已有的同一个工程。
        await openProjectObject({ ...project, id: newId(), updatedAt: Date.now() });
        void collectGarbageAssets();
    } catch (error) {
        reportError(t('project:errors.importProject'), error);
    }
};

// ---------------------------------------------------------------------------------------------
// 输入

export const importAudioFile = async (file: File) => {
    try {
        setSession({ status: t('project:status.reading'), error: null });
        const [ref, metadata] = await Promise.all([putAsset(file, file.name), readAudioMetadata(file)]);
        let coverRef: AssetRef | null = null;
        const project = getProject();
        if (metadata.cover && !project.cover) coverRef = await putAsset(metadata.cover, 'cover');
        updateProject(current => ({
            ...current,
            name: isUntitled(current.name) && (metadata.title || file.name)
                ? (metadata.title || file.name.replace(/\.[^.]+$/, ''))
                : current.name,
            audio: ref,
            cover: coverRef ?? current.cover,
            meta: {
                title: current.meta.title || metadata.title || '',
                artist: current.meta.artist || metadata.artist || '',
                album: current.meta.album || metadata.album || '',
            },
            // 没有字幕时退而用内嵌歌词。
            lyrics: current.lyrics ?? (metadata.embeddedLyrics
                ? { fileName: `${file.name}.embedded.lrc`, content: metadata.embeddedLyrics }
                : null),
        }));
        if (coverRef) void loadCoverIntoSession(metadata.cover);
        await loadAudioIntoSession(file);
    } catch (error) {
        reportError(t('project:errors.importAudio'), error);
    }
};

export const importLyricsFile = async (file: File, kind: 'lyrics' | 'translation' = 'lyrics') => {
    try {
        const content = await file.text();
        updateProject(project => ({
            ...project,
            [kind]: { fileName: file.name, content },
            // 换了歌词，旧的逐行修改大多会失效；保留它们，失效的会在编辑器里列出来。
        }));
    } catch (error) {
        reportError(t('project:errors.readLyrics'), error);
    }
};

export const clearLyrics = (kind: 'lyrics' | 'translation') => updateProject(project => ({ ...project, [kind]: null }));

export const importCoverFile = async (file: File) => {
    try {
        const ref = await putAsset(file, file.name);
        updateProject(project => ({ ...project, cover: ref }));
        await loadCoverIntoSession(file);
    } catch (error) {
        reportError(t('project:errors.importCover'), error);
    }
};

export const clearCover = () => {
    updateProject(project => ({ ...project, cover: null }));
    void loadCoverIntoSession(null);
};
