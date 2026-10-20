// src/packs/contract.ts
// 风格包（Style Pack）契约。一个包 = 一套 PV 视觉语言：自己的镜头风格目录、切块与选风格的规则、
// 转场、场景构建与每帧更新、设置面板。编译器、内核、编辑器都只通过这个契约和注册表访问包，
// 所以新增一个包不需要改它们。内置的凝彩（tempera）与商籁（sonnet）也是这样注册进来的。
import type { ComponentType } from 'react';
import type { Line } from '@/core/types';
import type {
    EditOp,
    LumiParagraph,
    LumiProgram,
    LumiShot,
    LumiTransition,
    ParagraphKind,
    UnifiedLine,
} from '@/compiler/types';
import type { KernelTransitionFrame } from '@/kernel/transitions';
import type { PackAdapter } from '@/kernel/adapters/types';

export type PackId = string;
export type Mood = 'quiet' | 'neutral' | 'loud';

export interface FamilyDef {
    id: string;
    pack: PackId;
    label: string;
    /** 一句话描述这一族的画面（给 AI 编排与 agent 看；族名本身看不出来时写）。 */
    description?: string;
}

export interface StyleDef {
    /** `pack/kind` */
    id: string;
    pack: PackId;
    kind: string;
    family: string;
    mood: Mood;
    /** 中文显示名（不给时界面用 kind）。 */
    label?: string;
    /**
     * 一两句话描述这个风格实际的画面：构图、文字怎么排怎么动、图形 / 光效 / 装饰、适合的段落。
     * 给 AI 编排与 agent 的 list_styles 看，要写看得到的东西，不要只复述名字。
     */
    description?: string;
    /** 检索用的关键词（画面元素、情绪、节奏），agent 可按关键词筛风格。 */
    keywords?: string[];
}

/**
 * 路线 E（组件化）：一个镜头 = 构图（风格本身）× 排版 × 点缀。除了风格，包可以把其余部件声明成
 * 组件槽，编辑器逐镜头替换（EditOp `shot-component`）。
 */
export interface ComponentSlotDef {
    /** 例如 `typography`、`accent`。 */
    id: string;
    label: string;
    /** 这个槽换的是什么（给 agent 看）。 */
    description?: string;
    /** description：这个选项的画面（给 agent 看；label 看不出来时写）。 */
    options: Array<{ id: string; label: string; description?: string }>;
}

/**
 * 构图留给文字的区域（相对画面的比例坐标，中心点 + 宽高）。排版只在这里面排，所以换排版、
 * 以后跨包借排版都不会压到构图的关键部分（比如镂空的洞）。
 */
export interface TextRegion {
    cx: number;
    cy: number;
    w: number;
    h: number;
    /** 弧度。 */
    rotation: number;
    align: 'center' | 'left' | 'right';
}

export interface TransitionFrameContext {
    /** 场景自己的转场种子（由包的适配器给出）。 */
    transitionSeed: number;
    /** 运动方向（弧度），没有 flow 概念的包给 0。 */
    flowAngle: number;
}

export interface TransitionDef {
    /** `pack/kind` */
    id: string;
    pack: PackId;
    kind: string;
    label: string;
    /** 转场窗口内预卷下一段的场景（平移类转场需要「另一头」有东西）。 */
    preRoll: boolean;
    /** 段落边界处的时长；gap 为两段之间的空隙。 */
    duration: (gap: number) => number;
    /** 边界之后进入阶段的时长钳制。 */
    enterClamp: [number, number];
    /**
     * 接缝转场：交界两侧都是本包的镜头时，内核把两个场景单元并成一个（StylePack.joinParagraphs），
     * 由包在单元内部像段内换镜头一样交接，不走 resolveFrame；两侧不是同一个包时照常按 resolveFrame 衔接。
     */
    joins?: boolean;
    resolveFrame: (phase: 'enter' | 'exit', progress: number, context: TransitionFrameContext) => KernelTransitionFrame;
}

/**
 * 与包无关的镜头覆盖范围：跨包换风格时，源包把镜头描述成 span，目标包据此造自己的镜头。
 * 切片用行内文字偏移表示（各包的分词不必一致）。
 */
export interface ShotSpan {
    id: string;
    startTime: number;
    endTime: number;
    lyricEndTime: number;
    slices: Array<{ lineIndex: number; startOffset: number; endOffset: number }>;
    isBridge: boolean;
}

/** 编译器给包的选风格钩子。 */
export interface CastContext {
    /** 风格库偏好与族限制过滤后的候选（kind 列表，收藏的出现两次）；返回 null 表示不过滤。 */
    filterCandidates: ((defaults: readonly string[]) => readonly string[]) | null;
    /** 0..1；null 表示由包按自己的规则决定。 */
    energy: number | null;
    /** 锁定的风格：slot 为该行上的第几个镜头（`s<n>`）或间奏 `b<n>`。lineIndex 为 null 时是间奏。 */
    forceKind: ((slot: { lineIndex: number | null; slot: string }) => string | null) | null;
}

/** 用户逐镜头指定的组件（槽 id → 选项 id）。 */
export type ShotComponents = Record<string, string>;

export interface ParagraphCompileContext<Tuning, Params> {
    seed: string;
    paragraphIndex: number;
    kind: ParagraphKind;
    /** 本段的行。 */
    lines: UnifiedLine[];
    /** 全曲的行。 */
    songLines: UnifiedLine[];
    /** 下一段的开始时间（最后一段为 null），用于间奏镜头。 */
    nextStartTime: number | null;
    /** 本段的渲染结束时间。 */
    endTime: number;
    tuning: Tuning;
    params: Params;
    cast: CastContext;
}

export interface CompiledShot<NativeShot> {
    native: NativeShot;
    /** 锚定到哪一行的第几个 slot（行序号 + slot）。间奏镜头锚在本段末行。 */
    lineIndex: number;
    slot: string;
}

export interface NativeSliceOptions {
    /** 只取这些镜头（段内一串连续的同包镜头）；默认整段。 */
    shots?: LumiShot[];
    startTime?: number;
    endTime?: number;
    transitionOut?: LumiTransition | null;
    /** 同段第二个及以后的单元：原生段落 id 加后缀，场景里按 id 播种的装饰才不会重复。 */
    idSuffix?: string;
}

export interface PackSettingsProps<Tuning, Params> {
    tuning: Tuning;
    params: Params;
    patchTuning: (patch: Partial<Tuning>, key: string) => void;
    patchParams: (patch: Partial<Params>, key: string) => void;
}

export interface StylePack<Tuning = any, Params = any, Chain = any, NativeShot = any, NativeParagraph = any> {
    id: PackId;
    /** 界面上的顺序（小的在前，不写排在最后）；排第一的包是找不到指定包时的退路。 */
    order?: number;
    label: string;
    /** 界面上的短名。 */
    shortLabel: string;
    /** 时间轴与标签上用的颜色（CSS 颜色）。 */
    color: string;
    /** 一两句话描述这套视觉语言；AI 编排据此决定哪段用哪个包。 */
    description: string;
    version: number;

    families: FamilyDef[];
    styles: StyleDef[];
    transitions: TransitionDef[];
    /** 段内进入本包镜头时（跨包镜头边界）用的短转场。 */
    shotBoundaryTransition: string;

    tuning: {
        defaults: Tuning;
        normalize: (raw: unknown) => Tuning;
    };
    /** 编译参数（切块等），存在工程的 engineParams.packs[id]。 */
    params: {
        defaults: Params;
        normalize: (raw: unknown) => Params;
    };

    /** 把一行切成本包的片段（存在 UnifiedLine.segments[id]）。 */
    segmentLine: (line: Line) => unknown;

    /** 跨段落的编译状态（上一个镜头的风格、flow 等）。 */
    createChain: () => Chain;
    /** ③④⑤：本段的镜头（含间奏镜头）。 */
    compileParagraph: (context: ParagraphCompileContext<Tuning, Params>, chain: Chain) => Array<CompiledShot<NativeShot>>;
    /** 自动选段落的出场转场（返回本包的转场 kind）。 */
    chooseTransition: (seed: string, paragraphIndex: number, previousKind: string | null) => string;
    /**
     * 本包段落接本包段落（交界两侧的镜头都是本包的）时，自动转场改用的接缝转场 id（TransitionDef.joins）；
     * 返回 null 照常按 chooseTransition。用户指定的转场不受影响。
     */
    seamlessTransition?: (tuning: Tuning) => string | null;
    /**
     * 接缝转场（TransitionDef.joins）：把首尾相接的几个本包单元（toNativeParagraph 的结果，按时间顺序）
     * 并成一个；返回的 id 用作场景的随机流 key。
     */
    joinParagraphs?: (parts: Array<{ id: string; data: NativeParagraph }>) => { id: string; data: NativeParagraph };
    /** 原生镜头的公共信息；lines 为全曲的统一行（按行序号索引）。components 为该镜头各组件槽当前的取值。 */
    describeShot: (native: NativeShot, lines: UnifiedLine[]) => { id: string; kind: string; span: ShotSpan; components?: ShotComponents };

    /** 路线 E：可逐镜头替换的组件槽（不提供则只能换整个风格）。 */
    componentSlots?: ComponentSlotDef[];
    /** 把指定的组件套到镜头上（编译完成后调用；只会收到本包 componentSlots 里声明过的槽与选项）。 */
    applyComponents?: (native: NativeShot, components: ShotComponents) => NativeShot;
    /** 某个风格的构图留给文字的区域；编辑器用它在预览上标出来，跨包借排版时字排在这里。 */
    textRegion?: (kind: string) => TextRegion | null;
    /**
     * 跨包借排版（客）：本包可以借给别的包的排版。kind 是造客镜头时用的本包风格（它的
     * textRegion 决定客镜头的字排在哪，内核把这块区域对齐到宿主的区域）。同时要提供
     * `fromSpan`、`textOnlyTuning`，排版 id 若是本包 typography 槽的选项会经 applyComponents 套上。
     */
    typographyExports?: Array<{ id: string; label: string; kind: string }>;
    /** 跨包借排版（客）：只画字、背景透明、不带转场的 tuning。 */
    textOnlyTuning?: (tuning: Tuning) => Tuning;
    /** 跨包借排版（宿主）：隐藏本镜头自己的字，构图与点缀照常。 */
    hideText?: (native: NativeShot) => NativeShot;
    /** 平移类转场的预卷：把段首镜头的起点提前（不支持时不提供）。 */
    applyPreRoll?: (native: NativeShot, startTime: number) => NativeShot;
    /** 路线 D：用另一个包镜头的覆盖范围造本包的镜头；做不到（比如间奏）返回 null。 */
    fromSpan?: (
        span: ShotSpan,
        kind: string,
        context: Omit<ParagraphCompileContext<Tuning, Params>, 'cast' | 'nextStartTime' | 'endTime'> & { shotIndex: number },
        chain: Chain,
    ) => { shot: NativeShot; extra?: unknown } | null;

    /** 段落（或段内一串连续的本包镜头）→ 包自己的段落结构；id 用作场景的随机流 key。 */
    toNativeParagraph: (program: LumiProgram, paragraph: LumiParagraph, options?: NativeSliceOptions) => { id: string; data: NativeParagraph };
    createAdapter: () => PackAdapter;

    /** 设置面板（「画面与编排」侧栏里本包的分组）。 */
    SettingsPanel?: ComponentType<PackSettingsProps<Tuning, Params>>;
}

// 仅供类型引用，避免循环导入时丢失。
export type { EditOp };
