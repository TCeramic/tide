// src/project/types.ts
// 一个 lumisynth 工程。纯数据、可 JSON 序列化；大文件（音频、封面、图片）只存 AssetRef，本体在 IndexedDB。
import type { DualTheme } from '@/core/types';
import type { LyricEdits } from '@/core/lyrics/edits';
import type { DirectionSettings, EditOp, LibraryPrefs, ParagraphDirectionOverride, StructureEdit } from '@/compiler/types';
import type { PackId } from '@/packs/contract';
import type { KernelTuning } from '@/kernel/tuning';
import type { EngineParams } from '@/compiler/params';
import type { ProjectTypography } from './typography';
import type { LibraryAsset } from './assets';
import type { AssetClip } from '@/core/assets/clips';
import type { BackgroundClip } from '@/core/assets/background';

export const PROJECT_VERSION = 1;

export interface AssetRef {
    id: string;
    name: string;
    type: string;
    size: number;
}

export interface LyricSourceFile {
    fileName: string;
    content: string;
}

export type OutputAspect = '16:9' | '9:16' | '1:1' | '4:3';

/**
 * 逻辑画幅。排版全部按逻辑像素算，预览按 CSS 缩放、导出按倍率放大，所以两者构图完全一致。
 * 短边统一 720。
 */
export const OUTPUT_LOGICAL_SIZES: Record<OutputAspect, { width: number; height: number }> = {
    '16:9': { width: 1280, height: 720 },
    '9:16': { width: 720, height: 1280 },
    '1:1': { width: 720, height: 720 },
    '4:3': { width: 960, height: 720 },
};

export interface ProjectTheme {
    source: 'preset' | 'ai' | 'custom';
    dual: DualTheme;
    variant: 'dark' | 'light';
}

export type StyleLibraryPrefs = LibraryPrefs;

export interface LumiProject {
    version: typeof PROJECT_VERSION;
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;

    audio: AssetRef | null;
    cover: AssetRef | null;
    lyrics: LyricSourceFile | null;
    translation: LyricSourceFile | null;
    meta: { title: string; artist: string; album: string };

    lyricEdits: LyricEdits;
    theme: ProjectTheme;
    seed: string;
    aspect: OutputAspect;

    direction: DirectionSettings;
    /** 自动编排的切分参数，默认与 folia 相同。 */
    engineParams: EngineParams;
    paragraphDirections: ParagraphDirectionOverride[];
    overrides: EditOp[];
    /** 手动分段、合并与段落性质。 */
    structureEdits: StructureEdit[];
    library: StyleLibraryPrefs;

    tuning: {
        kernel: KernelTuning;
        /** 每个风格包自己的 tuning，按包 id（结构由包决定，读入时经包的 normalize 补齐）。 */
        packs: Record<PackId, unknown>;
    };
    /** 素材库（图片；背景视频见 M20）。凝彩的图片池按 id 引用这里的图片。 */
    assets: LibraryAsset[];
    /** 放在画面上的素材片段（内核的素材层，与风格包无关）。 */
    assetClips: AssetClip[];
    /** 背景轨：叠在默认背景（tuning.kernel.background）之上的片段。 */
    backgroundClips: BackgroundClip[];
    /** 字体设置（与主题分开，换主题不影响）。 */
    typography: ProjectTypography;
}

