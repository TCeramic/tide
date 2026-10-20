// src/compiler/types.ts
// 统一 IR（LumiProgram）与编译器的输入契约。所有编排决定——自动规则、用户、AI——都只落在
// Direction 与 EditOp 上，编译器把它们和歌词一起算成 LumiProgram；runtime 只读 LumiProgram。
// 这里不认识任何具体的风格包：包由 src/packs/registry.ts 注册，原生结构对这里是不透明的。
import type { Line } from '@/core/types';
import type { LineAnchor } from '@/core/lyrics/edits';
import type { PackId } from '@/packs/contract';

export type { PackId };
/** `pack/kind`，例如 `tempera/duo-split`、`sonnet/type-impact`。 */
export type StyleId = string;
export type TransitionId = string;

export type ParagraphKind = 'breath' | 'verse' | 'lift' | 'chorus' | 'break' | 'outro';
/** manual：用户在这一行强制开了新段。 */
export type ParagraphBoundary = 'song-start' | 'time-gap' | 'lyric-gap' | 'metadata' | 'duration-cap' | 'line-cap' | 'manual';
export const PARAGRAPH_KINDS: ParagraphKind[] = ['verse', 'lift', 'chorus', 'breath', 'break', 'outro'];

export { splitStyleId } from '@/packs/registry';

// ---------------------------------------------------------------------------------------------
// ① Structure

/**
 * 用户对分段的修改，按行锚定：
 * - break：在这一行强制开新段；
 * - join：取消这一行前面的分段（这一段并进上一段），合并后的段落不再被行数 / 时长上限切开；
 * - kind：以这一行开头的段落，性质改为 kind。
 */
export type StructureEdit =
    | { id: string; type: 'break'; anchor: LineAnchor }
    | { id: string; type: 'join'; anchor: LineAnchor }
    | { id: string; type: 'kind'; anchor: LineAnchor; kind: ParagraphKind };

export interface InvalidStructureEdit {
    edit: StructureEdit;
    /** line-missing：行不在了或文字变了；first-line：第一行本来就是段首；not-paragraph-start：这一行已经不是段首。 */
    reason: 'line-missing' | 'first-line' | 'not-paragraph-start';
}

export interface UnifiedLine {
    sourceIndex: number;
    line: Line;
    renderEndTime: number;
    anchor: LineAnchor;
    /** 每个已注册的包各自的分词结果（包的 segmentLine 产出，结构由包决定）。 */
    segments: Record<PackId, unknown>;
}

export interface ParagraphAnchor {
    /** 段首行。 */
    line: LineAnchor;
}

// ---------------------------------------------------------------------------------------------
// ② Direction

export interface DirectionSettings {
    /**
     * single：全曲一个包；mix：按段落性质分配（mixByKind）。
     * 用户或 AI 给某段指定的包总是优先。
     */
    mode: 'single' | 'mix';
    pack: PackId;
    /**
     * mix 模式下和默认分配（DEFAULT_MIX_BY_KIND）不同的那几种段落性质用哪个包。只存改过的：
     * 默认分配以后调整（比如装了新包），没改过的段落跟着变。用 mixAssignment 取完整的分配。
     */
    mixByKind?: Partial<Record<ParagraphKind, PackId>>;
    /** 按 shot 混用（路线 D）：段内可以出现另一个包的 shot。 */
    shotMixing: boolean;
}

/**
 * 默认的 mix 分配：副歌交给 tempera 的大面积构图；副歌前的蓄力（上扬）与器乐间奏交给 lumiere 的光学场景；
 * 叙述性段落（主歌、换气、尾声）交给 sonnet 的排字运动。
 */
export const DEFAULT_MIX_BY_KIND: Record<ParagraphKind, PackId> = {
    chorus: 'tempera',
    lift: 'lumiere',
    break: 'lumiere',
    verse: 'sonnet',
    breath: 'sonnet',
    outro: 'sonnet',
};

/** 完整的 mix 分配：默认分配 + 工程里改过的。 */
export const mixAssignment = (direction: Pick<DirectionSettings, 'mixByKind'>): Record<ParagraphKind, PackId> => ({ ...DEFAULT_MIX_BY_KIND, ...direction.mixByKind });

/** 只留和默认分配不同的项（存进工程的形式）。 */
export const mixOverrides = (mix: Partial<Record<ParagraphKind, PackId>>): Partial<Record<ParagraphKind, PackId>> => Object.fromEntries(
    Object.entries(mix).filter(([kind, pack]) => pack !== DEFAULT_MIX_BY_KIND[kind as ParagraphKind]),
);

export const DEFAULT_DIRECTION_SETTINGS: DirectionSettings = {
    mode: 'single',
    pack: 'tempera',
    mixByKind: {},
    shotMixing: false,
};

export interface ParagraphDirection {
    pack: PackId;
    /** 0..1。null 表示由包按自己的规则（段落性质、字数）决定。 */
    energy: number | null;
    /** 允许的 shot 族（包内的族 id）。null 表示不限。 */
    families: string[] | null;
    source: 'auto' | 'user' | 'ai';
}

export interface ParagraphDirectionOverride {
    anchor: ParagraphAnchor;
    pack?: PackId;
    energy?: number | null;
    families?: string[] | null;
    source: 'user' | 'ai';
}

// ---------------------------------------------------------------------------------------------
// ④ Cast：风格库偏好

export interface LibraryPrefs {
    /** 收藏的风格被选中的概率翻倍。 */
    favorites: StyleId[];
    /** 屏蔽的风格不参与自动选择（锁定仍然可以用）。 */
    blocked: StyleId[];
}

export const EMPTY_LIBRARY_PREFS: LibraryPrefs = { favorites: [], blocked: [] };

// ---------------------------------------------------------------------------------------------
// ⑥ Overrides

/**
 * shot 的锚：它的第一句歌词（行序号 + 文本哈希）+ 该行上的第几个 shot。
 * 间奏 bridge shot 没有歌词，锚在所属段落的末行上，slot 为 `b<n>`。
 */
export interface ShotAnchor {
    line: LineAnchor;
    slot: string;
}

export type EditOp =
    | { id: string; type: 'shot-style'; anchor: ShotAnchor; style: StyleId }
    /** 路线 E：替换镜头的一个组件（排版、点缀……由包的 componentSlots 声明）。 */
    | { id: string; type: 'shot-component'; anchor: ShotAnchor; slot: string; value: string }
    | { id: string; type: 'transition'; anchor: ParagraphAnchor; transition: TransitionId | 'none' };

export interface InvalidEditOp {
    op: EditOp;
    /**
     * anchor-missing：锚定的行或 shot 已不存在（歌词或分段变了）；
     * style-unknown / transition-unknown：风格或转场不存在（比如所属的包没有装）；
     * pack-mismatch：风格属于另一个包，而没有开按 shot 混用（或那个包不支持这样转换）。
     */
    reason: 'anchor-missing' | 'style-unknown' | 'transition-unknown' | 'pack-mismatch' | 'component-unknown';
}

// ---------------------------------------------------------------------------------------------
// LumiProgram

/** 包自己的镜头结构，对编译器与内核不透明。 */
export interface NativeShot {
    pack: PackId;
    shot: unknown;
    /** 包需要随镜头携带的额外数据（例如 sonnet 从半句切片转来时的伪行）。 */
    extra?: unknown;
}

export interface LumiShot {
    id: string;
    anchor: ShotAnchor;
    pack: PackId;
    style: StyleId;
    startTime: number;
    endTime: number;
    /** 最后一个字唱完的时刻（间奏镜头为结束时刻）。 */
    lyricEndTime: number;
    lineIndices: number[];
    isBridge: boolean;
    /** 风格由 EditOp 指定（锁定），而不是由 Cast 选出。 */
    locked: boolean;
    /** 各组件槽当前的取值（包没有组件槽时为空）。 */
    components: Record<string, string>;
    /** 用户逐镜头指定过的组件槽。 */
    lockedComponents: string[];
    native: NativeShot;
    /**
     * 路线 E 跨包借排版：本镜头的字由另一个包排（宿主隐藏自己的字）。客包的镜头只画字，
     * 排进宿主构图的文字区域。
     */
    borrowedText?: BorrowedText;
}

export interface BorrowedText {
    pack: PackId;
    /** 客包导出的排版 id。 */
    typography: string;
    native: NativeShot;
    /** 宿主构图留给文字的区域，与客包排版自己的区域（用来把后者对齐到前者）。 */
    hostRegion: import('@/packs/contract').TextRegion;
    guestRegion: import('@/packs/contract').TextRegion;
}

export interface LumiTransition {
    id: TransitionId;
    startTime: number;
    endTime: number;
    source: 'auto' | 'user';
}

export interface LumiParagraph {
    id: string;
    index: number;
    kind: ParagraphKind;
    /** 性质是用户指定的。 */
    kindManual: boolean;
    boundary: ParagraphBoundary;
    /** 这一段里有用户合并进来的部分。 */
    merged: boolean;
    startTime: number;
    endTime: number;
    lineIndices: number[];
    anchor: ParagraphAnchor;
    direction: ParagraphDirection;
    shots: LumiShot[];
    transitionOut: LumiTransition | null;
}

export interface LumiProgram {
    version: 1;
    seed: string;
    paragraphGapThreshold: number;
    lines: UnifiedLine[];
    paragraphs: LumiParagraph[];
    invalidOps: InvalidEditOp[];
    /** 锚定的段首行已不存在或不再是段首，或者指定的包没有装。 */
    invalidDirections: ParagraphDirectionOverride[];
    invalidStructureEdits: InvalidStructureEdit[];
}

/** 包自己的段落结构，交给包的场景构建器，对内核不透明。 */
export interface NativeParagraph {
    pack: PackId;
    id: string;
    paragraph: unknown;
}
