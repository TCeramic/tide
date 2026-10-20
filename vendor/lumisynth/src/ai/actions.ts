// src/ai/actions.ts
// AI 的三件事，结果都写进工程（进撤销栈），和手动编辑走同一条路：
//   主题配色 → project.theme（source 'ai'）
//   分词     → lyricEdits.segments（按行锚定）
//   场景编排 → paragraphDirections（source 'ai'）与段落转场 EditOp（id 前缀 `ai-`）
import type { LumiProgram } from '@/compiler/types';
import { averageEnergy, type AudioAnalysis } from '@/core/audio/analysis';
import { isValidWordSegmentation } from '@/core/lyrics/wordSegmentation';
import { listPacks } from '@/packs/registry';
import { newId } from '@/project/defaults';
import { updateProject } from '@/project/store';
import type { LumiProject } from '@/project/types';
import { sanitizeSceneDirection, type SceneDirectionRequest, type SceneDirectionResponse } from './sceneDirection';
import { requestSceneDirection, requestSegmentation, requestTheme } from './client';

const isLyricLine = (text: string) => text.trim().length > 0 && text !== '......' && text !== '♪';

// ---------------------------------------------------------------------------------------------
// 主题

export const generateAiTheme = async (program: LumiProgram, project: LumiProject, signal?: AbortSignal) => {
    const lyricLines = program.lines.map(line => line.line.fullText).filter(isLyricLine);
    const isPureMusic = lyricLines.length === 0;
    const text = isPureMusic ? (project.meta.title || project.name) : lyricLines.join('\n');
    const dual = await requestTheme(text, isPureMusic, project.meta.title, signal);
    updateProject(p => ({ ...p, theme: { ...p.theme, source: 'ai', dual } }));
    return dual;
};

// ---------------------------------------------------------------------------------------------
// 分词

const SEGMENT_BATCH = 200;

export const generateAiSegmentation = async (
    program: LumiProgram,
    options: { keepManual: boolean },
    project: LumiProject,
    signal?: AbortSignal,
) => {
    const manual = new Set(project.lyricEdits.segments.map(item => `${item.anchor.index}:${item.anchor.hash}`));
    const targets = program.lines.filter(line => isLyricLine(line.line.fullText)
        && !(options.keepManual && manual.has(`${line.anchor.index}:${line.anchor.hash}`)));
    if (targets.length === 0) return 0;
    const results: Array<{ index: number; hash: string; parts: string[] }> = [];
    for (let start = 0; start < targets.length; start += SEGMENT_BATCH) {
        const batch = targets.slice(start, start + SEGMENT_BATCH);
        const { lines } = await requestSegmentation(batch.map(line => line.line.fullText), signal);
        batch.forEach((line, i) => {
            const parts = lines[i];
            // 服务端已经校验过；这里再确认一遍拼起来与原文一致。
            if (Array.isArray(parts) && isValidWordSegmentation(line.line.fullText, parts)) {
                results.push({ index: line.anchor.index, hash: line.anchor.hash, parts });
            }
        });
    }
    updateProject(p => {
        const replaced = new Set(results.map(item => `${item.index}:${item.hash}`));
        const kept = p.lyricEdits.segments.filter(item => !replaced.has(`${item.anchor.index}:${item.anchor.hash}`));
        return {
            ...p,
            lyricEdits: {
                ...p.lyricEdits,
                segments: [...kept, ...results.map(item => ({ anchor: { index: item.index, hash: item.hash }, parts: item.parts }))],
            },
        };
    });
    return results.length;
};

// ---------------------------------------------------------------------------------------------
// 场景编排

export const buildSceneDirectionRequest = (
    program: LumiProgram,
    project: LumiProject,
    analysis: AudioAnalysis | null,
): SceneDirectionRequest => {
    const loudness = program.paragraphs.map(paragraph => averageEnergy(analysis, paragraph.startTime, paragraph.endTime));
    const max = Math.max(0.0001, ...loudness.map(value => value ?? 0));
    return {
        song: { title: project.meta.title || project.name, artist: project.meta.artist },
        packs: listPacks().map(pack => ({
            id: pack.id,
            label: pack.label,
            description: pack.description,
            families: pack.families.map(family => ({
                id: family.id,
                label: family.label,
                ...(family.description ? { description: family.description } : {}),
                moods: [...new Set(pack.styles.filter(style => style.family === family.id).map(style => style.mood))],
            })),
            transitions: pack.transitions.map(transition => ({ id: transition.id, label: transition.label })),
        })),
        paragraphs: program.paragraphs.map((paragraph, index) => ({
            index: paragraph.index,
            kind: paragraph.kind,
            startTime: paragraph.startTime,
            endTime: paragraph.endTime,
            text: paragraph.lineIndices.map(i => program.lines[i].line.fullText).filter(isLyricLine).join(' / '),
            // 在本曲内归一化：模型看的是相对响度。
            loudness: loudness[index] === null ? null : (loudness[index] as number) / max,
        })),
    };
};

/**
 * 写进工程：用户手动设置过的段落不动；以前的 AI 结果整体替换。
 */
export const applySceneDirection = (program: LumiProgram, response: SceneDirectionResponse) => updateProject(project => {
    const byIndex = new Map(program.paragraphs.map(paragraph => [paragraph.index, paragraph]));
    const userAnchors = new Set(project.paragraphDirections
        .filter(item => item.source === 'user')
        .map(item => `${item.anchor.line.index}:${item.anchor.line.hash}`));
    const userTransitions = new Set(project.overrides
        .filter(op => op.type === 'transition' && !op.id.startsWith('ai-'))
        .map(op => `${op.anchor.line.index}:${op.anchor.line.hash}`));

    const directions = project.paragraphDirections.filter(item => item.source !== 'ai');
    const overrides = project.overrides.filter(op => !op.id.startsWith('ai-'));
    for (const item of response.paragraphs) {
        const paragraph = byIndex.get(item.index);
        if (!paragraph) continue;
        const key = `${paragraph.anchor.line.index}:${paragraph.anchor.line.hash}`;
        if (!userAnchors.has(key)) {
            directions.push({
                anchor: paragraph.anchor,
                pack: item.pack,
                energy: item.energy,
                families: item.families.length > 0 ? item.families : null,
                source: 'ai',
            });
        }
        if (item.transition !== 'auto' && !userTransitions.has(key)
            && paragraph.index < program.paragraphs.length - 1) {
            overrides.push({ id: `ai-${newId()}`, type: 'transition', anchor: paragraph.anchor, transition: item.transition });
        }
    }
    return { ...project, paragraphDirections: directions, overrides };
});

export const clearSceneDirection = () => updateProject(project => ({
    ...project,
    paragraphDirections: project.paragraphDirections.filter(item => item.source !== 'ai'),
    overrides: project.overrides.filter(op => !op.id.startsWith('ai-')),
}));

export const generateSceneDirection = async (
    program: LumiProgram,
    project: LumiProject,
    analysis: AudioAnalysis | null,
    signal?: AbortSignal,
) => {
    const request = buildSceneDirectionRequest(program, project, analysis);
    const raw = await requestSceneDirection(request, signal);
    // 客户端的包目录才是权威的，再校验一遍。
    const response = sanitizeSceneDirection(raw, request);
    applySceneDirection(program, response);
    return { ...response, provider: raw.provider };
};
