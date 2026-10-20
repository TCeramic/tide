// src/compiler/params.ts
// 编译器里原本写死的常量。全局的分段参数在 paragraph 里；切块之类的参数属于各个包，
// 存在 packs[id]，默认值由包自己给出（内置包的默认值与 folia 相同）。
// 全曲重复识别与超限段落递归切分是 lumisynth 的增强，默认开启；兼容模式保留 folia 行为。
// 与 folia 逐字段相等的等价性测试用 FOLIA_COMPATIBLE_PARAMS。
import type { PackId, StylePack } from '@/packs/contract';

export interface StructureParams {
    /** 段落切分阈值 = 相邻行空隙中位数 × multiplier，钳在 [min, max] 秒。 */
    gapMultiplier: number;
    gapMin: number;
    gapMax: number;
    /** 超过行数或时长的段落在最大空隙处切开。 */
    maxLines: number;
    maxDuration: number;
    /** 超限段落的左半部分也继续切（修正 folia 只切右半部分的问题）。 */
    recursiveSplit: boolean;
    /** 无标注歌词按全曲重复推断副歌；上游兼容模式关闭。 */
    inferRepeatedLyrics?: boolean;
}

export interface EngineParams {
    paragraph: StructureParams;
    /** 各个包的编译参数；缺省时用包的默认值。 */
    packs: Record<PackId, unknown>;
}

export const DEFAULT_STRUCTURE_PARAMS: StructureParams = {
    gapMultiplier: 2.5, gapMin: 1.25, gapMax: 3.5, maxLines: 6, maxDuration: 18, recursiveSplit: true, inferRepeatedLyrics: true,
};

export const DEFAULT_ENGINE_PARAMS: EngineParams = { paragraph: DEFAULT_STRUCTURE_PARAMS, packs: {} };

export const FOLIA_COMPATIBLE_PARAMS: EngineParams = {
    paragraph: { ...DEFAULT_STRUCTURE_PARAMS, recursiveSplit: false, inferRepeatedLyrics: false },
    packs: {},
};

/** 读工程里的参数：补齐缺省字段，并把旧版工程的 `tempera` / `sonnet` 顶层字段迁到 packs 里。 */
export const normalizeEngineParams = (raw: unknown): EngineParams => {
    const source = (raw ?? {}) as Partial<EngineParams> & Record<string, unknown>;
    const packs: Record<PackId, unknown> = { ...(source.packs ?? {}) };
    for (const legacy of ['tempera', 'sonnet']) {
        if (source[legacy] && packs[legacy] === undefined) packs[legacy] = source[legacy];
    }
    return { paragraph: { ...DEFAULT_STRUCTURE_PARAMS, ...source.paragraph }, packs };
};

export const packParams = <Params>(params: EngineParams, pack: StylePack<unknown, Params>): Params => (
    pack.params.normalize(params.packs[pack.id])
);
