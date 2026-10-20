// src/script/env.ts
// 剧本要的上下文：工程、它的编排、歌词文件里的原始行、按工程编译的函数。
// 编排自己编（不用界面上的那一份：界面的编排里可能带着「试看」的临时修改）。
// 歌词文件的解析按内容缓存，应用剧本时的多次编译不用重复解析。
import { applyProjectLyricEdits, compileProjectProgram, parseProjectLyrics, type ParsedLyrics } from '@/app/derived';
import type { LumiProject } from '@/project/types';
import type { ScriptEnv } from './apply';

let cache: { lyrics: LumiProject['lyrics']; translation: LumiProject['translation']; parsed: ParsedLyrics } | null = null;

const parsedOf = (project: LumiProject) => {
    if (!cache || cache.lyrics !== project.lyrics || cache.translation !== project.translation) {
        cache = { lyrics: project.lyrics, translation: project.translation, parsed: parseProjectLyrics(project.lyrics, project.translation) };
    }
    return cache.parsed;
};

/** duration：音频时长（纯音乐的虚拟歌词按它排）。 */
export const scriptEnv = (project: LumiProject, duration: number | null): ScriptEnv => {
    const compile = (target: LumiProject) => {
        const lyrics = applyProjectLyricEdits(parsedOf(target), target.lyricEdits);
        return compileProjectProgram(target, lyrics.data, duration);
    };
    const source = parsedOf(project).source;
    return {
        project,
        program: compile(project),
        sourceLines: source && source.lines.length > 0 ? source.lines : null,
        compile,
    };
};
