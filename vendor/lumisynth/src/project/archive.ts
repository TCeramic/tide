// src/project/archive.ts
// .lumi：一个 zip，里面是 project.json 与 assets/<id>（原始文件，不转码）。
import { strFromU8, strToU8, unzip, zip, type Unzipped } from 'fflate';
import { normalizeProject } from './defaults';
import type { AssetRef, LumiProject } from './types';
import { t } from '@/i18n';

export const LUMI_EXTENSION = 'lumi';
const MANIFEST = 'project.json';

export const projectAssetRefs = (project: LumiProject): AssetRef[] => {
    const refs = [project.audio, project.cover, ...project.assets.map(item => item.asset), ...project.typography.fonts.map(font => font.asset)];
    const seen = new Set<string>();
    return refs.filter((ref): ref is AssetRef => {
        if (!ref || seen.has(ref.id)) return false;
        seen.add(ref.id);
        return true;
    });
};

export const packProject = async (
    project: LumiProject,
    getBlob: (id: string) => Promise<Blob | null>,
): Promise<Blob> => {
    const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
        [MANIFEST]: strToU8(JSON.stringify(project, null, 2)),
    };
    for (const ref of projectAssetRefs(project)) {
        const blob = await getBlob(ref.id);
        // 音频与图片本身已压缩，再压一遍只浪费时间。
        if (blob) files[`assets/${ref.id}`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    }
    const data = await new Promise<Uint8Array>((resolve, reject) => {
        zip(files, { level: 6 }, (error, result) => (error ? reject(error) : resolve(result)));
    });
    return new Blob([data as BlobPart], { type: 'application/zip' });
};

export interface UnpackedProject {
    project: LumiProject;
    assets: Array<{ ref: AssetRef; blob: Blob }>;
}

export const unpackProject = async (file: Blob): Promise<UnpackedProject> => {
    const entries = await new Promise<Unzipped>((resolve, reject) => {
        file.arrayBuffer().then(buffer => {
            unzip(new Uint8Array(buffer), (error, result) => (error ? reject(error) : resolve(result)));
        }, reject);
    });
    const manifest = entries[MANIFEST];
    if (!manifest) throw new Error(t('project:notLumi'));
    const project = normalizeProject(JSON.parse(strFromU8(manifest)) as Partial<LumiProject>);
    const assets = projectAssetRefs(project).flatMap(ref => {
        const bytes = entries[`assets/${ref.id}`];
        return bytes ? [{ ref, blob: new Blob([bytes as BlobPart], { type: ref.type }) }] : [];
    });
    return { project, assets };
};
