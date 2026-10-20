// src/export/projectExport.ts
// 从工程、会话与编排结果拼出导出的输入；导出对话框与 agent 的 export_video 共用。
import type { LumiProgram } from '@/compiler/types';
import { renderFonts } from '@/project/defaults';
import type { SessionState } from '@/project/session';
import { OUTPUT_LOGICAL_SIZES, type LumiProject } from '@/project/types';
import type { ExportInput } from './exporter';
import { resolveAssetClips } from '@/core/assets/clips';
import { resolveBackgroundClips } from '@/core/assets/background';

/** 按当前编排解析背景轨。 */
export const resolveProjectBackgrounds = (project: LumiProject, program: LumiProgram) => (
    resolveBackgroundClips(project.backgroundClips, program, new Set(project.assets.map(item => item.id)))
);

/** 按当前编排解析工程的素材片段（素材库里不存在的、锚点失效的列入 invalid）。 */
export const resolveProjectClips = (project: LumiProject, program: LumiProgram) => (
    resolveAssetClips(project.assetClips, program, new Set(project.assets.map(item => item.id)))
);

export const buildProjectExportInput = (project: LumiProject, program: LumiProgram, session: SessionState): ExportInput => {
    const logical = OUTPUT_LOGICAL_SIZES[project.aspect];
    return {
        program,
        lines: program.lines.map(line => line.line),
        look: {
            ...renderFonts(project),
            tunings: project.tuning,
            metadata: { title: project.meta.title || null, artist: project.meta.artist || null, album: project.meta.album || null },
            coverColors: session.coverColors,
            cover: session.coverBlob,
            layerImages: session.assetBlobs,
        },
        analysis: session.analysis,
        audio: session.audioBuffer,
        logicalWidth: logical.width,
        logicalHeight: logical.height,
        assetClips: resolveProjectClips(project, program).resolved,
        backgroundClips: resolveProjectBackgrounds(project, program).resolved,
    };
};

/** 短边像素 → 按工程画幅算出的偶数输出尺寸。 */
export const exportSizeFor = (project: LumiProject, shortSide: number) => {
    const logical = OUTPUT_LOGICAL_SIZES[project.aspect];
    const short = Math.min(logical.width, logical.height);
    const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
    return { width: even((logical.width / short) * shortSide), height: even((logical.height / short) * shortSide) };
};

export const exportFileName = (project: LumiProject, extension: string) => (
    `${(project.meta.title || project.name || 'lumisynth').replace(/[\/:*?"<>|]+/g, '_')}.${extension}`
);
