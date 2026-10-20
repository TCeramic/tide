// src/project/db.ts
// IndexedDB：工程 JSON 与资源文件分表存。资源按 id 引用，同一个文件可以被多个工程共用。
import Dexie, { type Table } from 'dexie';
import type { AssetRef, LumiProject } from './types';

export interface ProjectRow {
    id: string;
    name: string;
    updatedAt: number;
    data: LumiProject;
}

export interface AssetRow extends AssetRef {
    blob: Blob;
}

class LumiDatabase extends Dexie {
    projects!: Table<ProjectRow, string>;
    assets!: Table<AssetRow, string>;

    constructor() {
        super('lumisynth');
        this.version(1).stores({
            projects: 'id, updatedAt',
            assets: 'id',
        });
    }
}

let database: LumiDatabase | null = null;
const db = () => (database ??= new LumiDatabase());

export const saveProjectRow = (project: LumiProject) => db().projects.put({
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    data: project,
});

export const loadProjectRow = async (id: string) => (await db().projects.get(id))?.data ?? null;

export const listProjects = () => db().projects.orderBy('updatedAt').reverse().toArray();

export const deleteProjectRow = (id: string) => db().projects.delete(id);

export const putAsset = async (blob: Blob, name: string, id?: string): Promise<AssetRef> => {
    const ref: AssetRef = { id: id ?? crypto.randomUUID(), name, type: blob.type, size: blob.size };
    await db().assets.put({ ...ref, blob });
    return ref;
};

export const getAssetBlob = async (id: string) => (await db().assets.get(id))?.blob ?? null;

/** 删除不再被任何工程引用的资源。 */
export const collectGarbageAssets = async () => {
    const referenced = new Set<string>();
    (await db().projects.toArray()).forEach(row => {
        const project = row.data;
        if (project.audio) referenced.add(project.audio.id);
        if (project.cover) referenced.add(project.cover.id);
        (project.assets ?? []).forEach(item => referenced.add(item.asset.id));
        Object.values((project as { layerImageAssets?: Record<string, AssetRef> }).layerImageAssets ?? {}).forEach(asset => referenced.add(asset.id));
        (project.typography?.fonts ?? []).forEach(font => referenced.add(font.asset.id));
    });
    const stale = (await db().assets.toCollection().primaryKeys()).filter(id => !referenced.has(id));
    await db().assets.bulkDelete(stale);
    return stale.length;
};
