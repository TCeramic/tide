// src/app/derived.ts
// 从工程算出来的数据：解析后的歌词、应用修改后的歌词。只依赖相关字段，避免无关修改触发重算。
import { useMemo } from 'react';
import { compileLumiProgram } from '@/compiler/compile';
import type { EditOp, LumiProgram } from '@/compiler/types';
import { buildInstrumentalLines } from '@/core/lyrics/load';
import { useSession } from '@/project/session';
import type { LyricData } from '@/core/types';
import { applyLyricEdits, type InvalidEdit } from '@/core/lyrics/edits';
import { loadLyricFile, type LoadedLyricFormat } from '@/core/lyrics/load';
import { useProjectStore } from '@/project/store';
import type { LumiProject } from '@/project/types';

export interface ParsedLyrics {
    source: LyricData | null;
    format: LoadedLyricFormat | null;
    error: string | null;
}

export const parseProjectLyrics = (lyrics: LumiProject['lyrics'], translation: LumiProject['translation']): ParsedLyrics => {
    if (!lyrics) return { source: null, format: null, error: null };
    try {
        const loaded = loadLyricFile({
            fileName: lyrics.fileName,
            content: lyrics.content,
            translation: translation?.content,
        });
        return { source: loaded.data, format: loaded.format, error: null };
    } catch (error) {
        return { source: null, format: null, error: (error as Error).message };
    }
};

export const useParsedLyrics = (): ParsedLyrics => {
    const lyrics = useProjectStore(state => state.project.lyrics);
    const translation = useProjectStore(state => state.project.translation);
    return useMemo(() => parseProjectLyrics(lyrics, translation), [lyrics, translation]);
};

export interface EffectiveLyrics extends ParsedLyrics {
    /** 应用了时间校正与手动分词后的歌词；没有字幕时为 null（纯音乐）。 */
    data: LyricData | null;
    invalidEdits: InvalidEdit[];
}

export const applyProjectLyricEdits = (parsed: ParsedLyrics, edits: LumiProject['lyricEdits']): EffectiveLyrics => {
    if (!parsed.source) return { ...parsed, data: null, invalidEdits: [] };
    const applied = applyLyricEdits(parsed.source, edits);
    return { ...parsed, data: applied.data, invalidEdits: applied.invalid };
};

export const useComputeEffectiveLyrics = (): EffectiveLyrics => {
    const parsed = useParsedLyrics();
    const edits = useProjectStore(state => state.project.lyricEdits);
    return useMemo(() => applyProjectLyricEdits(parsed, edits), [parsed, edits]);
};

/**
 * 当前工程编译出的 LumiProgram。没有字幕时用纯音乐的虚拟歌词（♪）。
 * 只依赖影响编排的字段，主题、画幅之类的变化不会触发重编。
 */
export const compileProjectProgram = (project: LumiProject, data: LyricData | null, duration: number | null): LumiProgram => compileLumiProgram({
    lines: data && data.lines.length > 0 ? data.lines : buildInstrumentalLines(duration),
    seed: project.seed,
    direction: project.direction,
    paragraphDirections: project.paragraphDirections,
    overrides: project.overrides,
    structureEdits: project.structureEdits,
    library: project.library,
    params: project.engineParams,
    packTunings: project.tuning.packs,
});

/** 不经 React：直接从工程算出当前的歌词与编排（agent 工具在写入后要立刻读到新结果）。 */
export const computeProjectState = (project: LumiProject, duration: number | null) => {
    const lyrics = applyProjectLyricEdits(parseProjectLyrics(project.lyrics, project.translation), project.lyricEdits);
    return { lyrics, program: compileProjectProgram(project, lyrics.data, duration) };
};

const sameTarget = (a: EditOp, b: EditOp) => {
    if (a.type !== b.type) return false;
    if (a.type === 'shot-style' && b.type === 'shot-style') {
        return a.anchor.line.index === b.anchor.line.index && a.anchor.line.hash === b.anchor.line.hash && a.anchor.slot === b.anchor.slot;
    }
    if (a.type === 'shot-component' && b.type === 'shot-component') {
        return a.slot === b.slot && a.anchor.line.index === b.anchor.line.index && a.anchor.line.hash === b.anchor.line.hash && a.anchor.slot === b.anchor.slot;
    }
    if (a.type === 'transition' && b.type === 'transition') {
        return a.anchor.line.index === b.anchor.line.index && a.anchor.line.hash === b.anchor.line.hash;
    }
    return false;
};

/** 试看的修改取代同一目标上的工程修改。 */
export const applyPeek = (overrides: EditOp[], peek: EditOp[] | null) => (
    peek && peek.length > 0
        ? [...overrides.filter(op => !peek.some(item => sameTarget(op, item))), ...peek]
        : overrides
);

export const useCompileProgram = (effective: EffectiveLyrics): LumiProgram => {
    const { data } = effective;
    const duration = useSession(state => state.audioBuffer?.duration ?? null);
    const seed = useProjectStore(state => state.project.seed);
    const direction = useProjectStore(state => state.project.direction);
    const paragraphDirections = useProjectStore(state => state.project.paragraphDirections);
    const projectOverrides = useProjectStore(state => state.project.overrides);
    const peek = useSession(state => state.peek);
    const overrides = useMemo(() => applyPeek(projectOverrides, peek), [projectOverrides, peek]);
    const library = useProjectStore(state => state.project.library);
    const params = useProjectStore(state => state.project.engineParams);
    const packTunings = useProjectStore(state => state.project.tuning.packs);
    const structureEdits = useProjectStore(state => state.project.structureEdits);
    return useMemo(() => compileLumiProgram({
        lines: data && data.lines.length > 0 ? data.lines : buildInstrumentalLines(duration),
        seed,
        direction,
        paragraphDirections,
        overrides,
        library,
        params,
        packTunings,
        structureEdits,
    }), [data, duration, seed, direction, paragraphDirections, overrides, library, params, packTunings, structureEdits]);
};
