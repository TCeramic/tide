// src/core/lyrics/subtitleFormats.ts
// SRT 与 ASS/SSA：folia 的解析器不支持这两种，这里是 lumisynth 自己的。产出与 parserCore 相同形状的
// LyricData，并同样经过 finalizeParsedLyricLines（插间奏行、算 renderHints）。
import type { Line, LyricData, Word } from '@/core/types';
import type { LyricProcessingOptions } from '@/core/lyrics/types';
import {
    buildTimedWords,
    finalizeParsedLyricLines,
    findTranslationsForSortedStartTimes,
    type TimedTextEntry,
} from './parserCore';

export type SubtitleFormat = 'srt' | 'ass';

const normalize = (text: string) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

// ---------------------------------------------------------------------------------------------
// SRT

const SRT_TIMING = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

const srtTime = (h: string, m: string, s: string, ms: string) => (
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
);

/** HTML-ish tags (<i>, <font ...>) and ASS-style overrides some SRT writers leave in. */
const stripSrtMarkup = (text: string) => text
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .trim();

interface SrtCue {
    startTime: number;
    endTime: number;
    lines: string[];
}

export const parseSrtCues = (content: string): SrtCue[] => {
    const cues: SrtCue[] = [];
    for (const block of normalize(content).split(/\n\s*\n/)) {
        const rows = block.split('\n').map(row => row.trim()).filter(Boolean);
        const timingIndex = rows.findIndex(row => SRT_TIMING.test(row));
        if (timingIndex === -1) continue;
        const match = rows[timingIndex].match(SRT_TIMING)!;
        const lines = rows.slice(timingIndex + 1).map(stripSrtMarkup).filter(Boolean);
        if (lines.length === 0) continue;
        cues.push({
            startTime: srtTime(match[1], match[2], match[3], match[4]),
            endTime: srtTime(match[5], match[6], match[7], match[8]),
            lines,
        });
    }
    return cues.sort((a, b) => a.startTime - b.startTime);
};

/**
 * 双语 SRT 常见写法是每条两行：原文 + 译文。只有当多数（≥60%）多行 cue 恰好是两行时才这样拆，
 * 否则多行按空格并成一行。
 */
const isBilingualSrt = (cues: SrtCue[]) => {
    const multi = cues.filter(cue => cue.lines.length > 1);
    if (multi.length === 0 || multi.length < cues.length * 0.6) return false;
    return multi.filter(cue => cue.lines.length === 2).length >= multi.length * 0.6;
};

const cuesToEntries = (cues: SrtCue[], bilingual: boolean) => {
    const main: TimedTextEntry[] = [];
    const translation: TimedTextEntry[] = [];
    cues.forEach(cue => {
        const text = bilingual ? cue.lines[0] : cue.lines.join(' ');
        main.push({ startTime: cue.startTime, endTime: cue.endTime, text });
        if (bilingual && cue.lines.length > 1) {
            translation.push({ startTime: cue.startTime, endTime: cue.endTime, text: cue.lines.slice(1).join(' ') });
        }
    });
    return { main, translation };
};

const entriesToLines = (
    entries: TimedTextEntry[],
    translations: Array<string | undefined>,
    romanizations: Array<string | undefined> = [],
): Line[] => entries.map((entry, index) => {
    const next = entries[index + 1];
    const endTime = Math.max(entry.endTime ?? (next ? next.startTime : entry.startTime + 5), entry.startTime + 0.1);
    return {
        words: buildTimedWords(entry.text, entry.startTime, endTime),
        startTime: entry.startTime,
        endTime,
        fullText: entry.text,
        translation: translations[index],
        romanization: romanizations[index],
    };
});

export const parseSRT = (
    content: string,
    translationContent = '',
    options: LyricProcessingOptions = {},
): LyricData => {
    const cues = parseSrtCues(content);
    const { main, translation } = cuesToEntries(cues, isBilingualSrt(cues));
    // 单独上传的译文文件优先于内嵌的第二行。
    const external = translationContent ? cuesToEntries(parseSrtCues(translationContent), false).main : [];
    const translations = findTranslationsForSortedStartTimes(
        main.map(entry => entry.startTime),
        external.length > 0 ? external : translation,
    );
    return { lines: finalizeParsedLyricLines(entriesToLines(main, translations), options), isWordByWord: false };
};

// ---------------------------------------------------------------------------------------------
// ASS / SSA

const ASS_TIME = /^(\d+):(\d{2}):(\d{2})[.:](\d{1,3})$/;

const assTime = (value: string) => {
    const match = value.trim().match(ASS_TIME);
    if (!match) return Number.NaN;
    // 小数部分是百分之一秒（ASS 规范），但也容忍写成毫秒的文件。
    const fraction = match[4].length === 3 ? Number(match[4]) / 1000 : Number(match[4]) / 100;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + fraction;
};

export interface AssSyllable {
    text: string;
    /** 秒，相对行首。 */
    offset: number;
    duration: number;
}

export interface AssDialogue {
    startTime: number;
    endTime: number;
    style: string;
    name: string;
    text: string;
    /** 有 \k 系卡拉 OK 标签时的音节；没有则为空。 */
    syllables: AssSyllable[];
}

/** \N \n 换行、\h 硬空格；其余 override 块直接去掉。 */
const cleanAssText = (text: string) => text
    .replace(/\\[Nn]/g, ' ')
    .replace(/\\h/g, ' ');

const KARAOKE_TAG = /\\(?:k|kf|K|ko)(\d+)/g;

/**
 * 按 override 块切音节：每个含 \k 的块开启一个新音节，时长是该块里最后一个 \k 的值（厘秒）。
 * 没有 \k 的块只是样式，文本并入当前音节。
 */
export const parseAssKaraoke = (rawText: string): { text: string; syllables: AssSyllable[] } => {
    const syllables: AssSyllable[] = [];
    let text = '';
    let cursor = 0;
    let offset = 0;
    let current: AssSyllable | null = null;
    const blockRegex = /\{([^}]*)\}/g;
    let match: RegExpExecArray | null;
    const pushText = (chunk: string) => {
        const cleaned = cleanAssText(chunk);
        if (!cleaned) return;
        text += cleaned;
        if (current) current.text += cleaned;
    };
    while ((match = blockRegex.exec(rawText)) !== null) {
        pushText(rawText.slice(cursor, match.index));
        cursor = match.index + match[0].length;
        const durations = [...match[1].matchAll(KARAOKE_TAG)].map(m => Number(m[1]) / 100);
        if (durations.length > 0) {
            if (current) offset += current.duration;
            current = { text: '', offset, duration: durations.at(-1)! };
            syllables.push(current);
        }
    }
    pushText(rawText.slice(cursor));
    return { text: text.trim(), syllables: syllables.filter(s => s.text.length > 0 || s.duration > 0) };
};

export const parseAssDialogues = (content: string): AssDialogue[] => {
    const dialogues: AssDialogue[] = [];
    let section = '';
    let format = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    for (const rawLine of normalize(content).split('\n')) {
        const line = rawLine.trim();
        const header = line.match(/^\[(.+)\]$/);
        if (header) {
            section = header[1].toLowerCase();
            continue;
        }
        if (section !== 'events') continue;
        if (/^format\s*:/i.test(line)) {
            format = line.replace(/^format\s*:/i, '').split(',').map(field => field.trim().toLowerCase());
            continue;
        }
        if (!/^dialogue\s*:/i.test(line)) continue;
        const body = line.replace(/^dialogue\s*:/i, '').trimStart();
        // Text 是最后一个字段，可以含逗号，所以只切前 n-1 个。
        const fields: string[] = [];
        let rest = body;
        for (let i = 0; i < format.length - 1; i += 1) {
            const comma = rest.indexOf(',');
            if (comma === -1) break;
            fields.push(rest.slice(0, comma));
            rest = rest.slice(comma + 1);
        }
        fields.push(rest);
        const field = (name: string) => fields[format.indexOf(name)] ?? '';
        const startTime = assTime(field('start'));
        const endTime = assTime(field('end'));
        if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) continue;
        const { text, syllables } = parseAssKaraoke(field('text'));
        if (!text) continue;
        dialogues.push({ startTime, endTime, style: field('style').trim(), name: field('name').trim(), text, syllables });
    }
    return dialogues.sort((a, b) => a.startTime - b.startTime);
};

/**
 * 主轨样式：有卡拉 OK 标签的样式优先，否则取条目最多的样式。其余样式的条目按时间配对成译文——
 * 双语字幕通常把译文放在单独的样式里。
 */
const pickMainStyle = (dialogues: AssDialogue[]) => {
    const karaoke = dialogues.find(dialogue => dialogue.syllables.length > 0);
    if (karaoke) return karaoke.style;
    const counts = new Map<string, number>();
    dialogues.forEach(dialogue => counts.set(dialogue.style, (counts.get(dialogue.style) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
};

const syllablesToWords = (dialogue: AssDialogue): Word[] => {
    const words: Word[] = [];
    dialogue.syllables.forEach(syllable => {
        if (!syllable.text) return;
        const startTime = dialogue.startTime + syllable.offset;
        const endTime = Math.min(dialogue.endTime, startTime + Math.max(syllable.duration, 0.01));
        words.push({ text: syllable.text, startTime, endTime });
    });
    return words;
};

export const parseASS = (
    content: string,
    translationContent = '',
    options: LyricProcessingOptions = {},
): LyricData => {
    const dialogues = parseAssDialogues(content);
    const mainStyle = pickMainStyle(dialogues);
    const main = dialogues.filter(dialogue => dialogue.style === mainStyle);
    const others = dialogues.filter(dialogue => dialogue.style !== mainStyle);
    const external = translationContent ? parseAssDialogues(translationContent) : [];
    const translationEntries = (external.length > 0 ? external : others)
        .map(dialogue => ({ startTime: dialogue.startTime, endTime: dialogue.endTime, text: dialogue.text }));
    const translations = findTranslationsForSortedStartTimes(main.map(d => d.startTime), translationEntries);
    let wordByWord = false;
    const lines: Line[] = main.map((dialogue, index) => {
        const karaoke = syllablesToWords(dialogue);
        if (karaoke.length > 0) wordByWord = true;
        const endTime = Math.max(dialogue.endTime, dialogue.startTime + 0.1);
        return {
            words: karaoke.length > 0 ? karaoke : buildTimedWords(dialogue.text, dialogue.startTime, endTime),
            startTime: dialogue.startTime,
            endTime,
            fullText: karaoke.length > 0 ? karaoke.map(word => word.text).join('') : dialogue.text,
            translation: translations[index],
        };
    });
    return { lines: finalizeParsedLyricLines(lines, options), isWordByWord: wordByWord };
};

// ---------------------------------------------------------------------------------------------

export const detectSubtitleFormat = (fileName: string | undefined, content: string): SubtitleFormat | null => {
    const extension = fileName?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    if (extension === 'srt') return 'srt';
    if (extension === 'ass' || extension === 'ssa') return 'ass';
    const head = normalize(content).slice(0, 4000);
    if (/^\s*\[script info\]/im.test(head) || /^dialogue\s*:/im.test(head)) return 'ass';
    if (/^\s*\d+\s*\n\s*\d{1,2}:\d{2}:\d{2},\d{1,3}\s*-->/m.test(head)) return 'srt';
    return null;
};
