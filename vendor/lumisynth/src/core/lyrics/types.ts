// src/core/lyrics/types.ts
// folia src/utils/lyrics/types.ts 的子集：引擎与解析器只用到 LyricProcessingOptions。

export interface LyricProcessingOptions {
    includeInterludes?: boolean;
    filterPattern?: string | null;
    songId?: number;
    fetchChorusRanges?: (songId: number) => Promise<Array<{ startTime: number; endTime: number }>>;
}
