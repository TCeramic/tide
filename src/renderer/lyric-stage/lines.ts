import type { LyricLine } from "../../core/lyrics";
import type { YrcLine } from "../../shared/contract";
import type { LumiLine } from "./engine";

export interface StageLyricRows {
  yrc: readonly YrcLine[];
  original: readonly LyricLine[];
  translation: readonly LyricLine[];
  romanization: readonly LyricLine[];
}

const DEFAULT_LAST_LINE_MS = 3_600;

function nearest(rows: readonly LyricLine[], timeMs: number): LyricLine | undefined {
  let best: LyricLine | undefined;
  let delta = 1_501;
  for (const row of rows) {
    const nextDelta = Math.abs(row.timeMs - timeMs);
    if (nextDelta < delta) {
      best = row;
      delta = nextDelta;
    }
  }
  return best;
}

/**
 * LumiSynth 把每个 word 当成一个排版片段：按字素切分会把一个英文单词拆成十几个
 * 单字母片段，放大到舞台上就成了「只剩几个字母」。所以这里按「词」切分：CJK 由
 * Intl.Segmenter 的 word 粒度分成 1-3 字，拉丁文按空格成词，空白丢弃。
 */
function wordSegments(text: string): string[] {
  const Segmenter = Intl.Segmenter;
  if (Segmenter) {
    const words = [...new Segmenter(undefined, { granularity: "word" }).segment(text)]
      .filter(part => part.isWordLike)
      .map(part => part.segment)
      .filter(segment => segment.trim().length > 0);
    if (words.length > 0) return words;
  }
  const spaced = text.split(/\s+/).filter(part => part.length > 0);
  return spaced.length > 0 ? spaced : Array.from(text);
}

interface CharTiming { start: number; end: number }

/**
 * 网易云的逐字 yrc 对中文歌几乎都是一个字一个片段，直接喂给 LumiSynth 会让排版
 * 按「片段数」缩字号，舞台上就只剩一排小字。这里把逐字时间轴重新按词合并：
 * 片段的起止时间取它首尾两个字的时间，节奏仍然准确，片段数回到正常的 3-6 个。
 */
function mergeTimedWords(text: string, marks: readonly YrcLine["words"][number][], startMs: number, endMs: number): LumiLine["words"] {
  const timeline: CharTiming[] = [];
  for (const mark of marks) {
    const wordStart = Number.isFinite(mark.timeMs) && mark.timeMs >= 0 ? mark.timeMs : startMs;
    const duration = Number.isFinite(mark.durationMs) && mark.durationMs >= 0 ? Math.max(1, mark.durationMs) : 1;
    const glyphs = Array.from(mark.text).filter(char => char.trim().length > 0);
    if (glyphs.length === 0) continue;
    const step = duration / glyphs.length;
    glyphs.forEach((_glyph, index) => {
      timeline.push({ start: wordStart + step * index, end: wordStart + step * (index + 1) });
    });
  }
  const sourceGlyphs = Array.from(text).filter(char => char.trim().length > 0);
  const parts = wordSegments(text);
  if (parts.length === 0) return [];
  if (timeline.length !== sourceGlyphs.length || timeline.length === 0) {
    // 逐字时间轴和整行文字对不上（标点差异、双语行等）：退化成按时长比例分配。
    const weights = parts.map(part => Math.max(1, Array.from(part).length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const span = Math.max(1, endMs - startMs);
    let cursor = startMs;
    return parts.map((part, index) => {
      const start = cursor;
      cursor = index === parts.length - 1 ? endMs : start + (span * weights[index]) / totalWeight;
      return { text: part, startTime: start / 1_000, endTime: Math.max(start + 1, cursor) / 1_000 };
    });
  }
  const merged: LumiLine["words"] = [];
  let cursor = 0;
  for (const part of parts) {
    const length = Math.max(1, Array.from(part).filter(char => char.trim().length > 0).length);
    const first = timeline[Math.min(cursor, timeline.length - 1)];
    const last = timeline[Math.min(cursor + length - 1, timeline.length - 1)];
    cursor += length;
    merged.push({ text: part, startTime: first.start / 1_000, endTime: Math.max(first.start + 1, last.end) / 1_000 });
  }
  return merged;
}

function lineEnd(startMs: number, nextStartMs: number | undefined, authoredDurationMs: number | undefined, durationMs: number | undefined): number {
  if (authoredDurationMs != null) {
    const duration = Number.isFinite(authoredDurationMs) ? Math.max(1, authoredDurationMs) : 1;
    return startMs + duration;
  }
  if (nextStartMs != null && Number.isFinite(nextStartMs) && nextStartMs > startMs) return nextStartMs;
  if (durationMs != null && Number.isFinite(durationMs) && durationMs > startMs) return durationMs;
  return startMs + DEFAULT_LAST_LINE_MS;
}

/** Convert Tide's timed YRC/LRC rows to LumiSynth's seconds-based original Line model. */
export function toLumiLines(rows: StageLyricRows, durationMs?: number): LumiLine[] {
  const hasYrc = rows.yrc.length > 0;
  const sourceRows = hasYrc
    ? rows.yrc.map(row => ({ timeMs: row.timeMs, text: row.text, durationMs: row.durationMs, words: row.words }))
    : rows.original.map(row => ({ timeMs: row.timeMs, text: row.text, durationMs: undefined, words: [] as YrcLine["words"] }));

  return sourceRows.flatMap((row, index) => {
    const startMs = Math.max(0, Number.isFinite(row.timeMs) ? row.timeMs : 0);
    const nextStartMs = sourceRows[index + 1]?.timeMs;
    const endMs = lineEnd(startMs, nextStartMs, row.durationMs, durationMs);
    const translated = nearest(rows.translation, startMs);
    const romanized = nearest(rows.romanization, startMs);
    let words: LumiLine["words"];

    if (row.words.length > 0) {
      words = mergeTimedWords(row.text, row.words, startMs, endMs);
    } else {
      const parts = wordSegments(row.text);
      if (parts.length === 0) return [];
      // Author a proportional timing per word so a long word keeps the stage longer
      // than a single CJK character.
      const weights = parts.map(part => Math.max(1, Array.from(part).length));
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      const span = Math.max(1, endMs - startMs);
      let cursor = startMs;
      words = parts.map((text, wordIndex) => {
        const start = cursor;
        cursor = wordIndex === parts.length - 1 ? endMs : start + (span * weights[wordIndex]) / totalWeight;
        return {
          text,
          startTime: start / 1_000,
          endTime: Math.max(start + 1, cursor) / 1_000,
        };
      });
    }

    return [{
      words,
      startTime: startMs / 1_000,
      endTime: endMs / 1_000,
      fullText: row.text,
      translation: translated?.text,
      romanization: romanized?.text,
      sourceHash: `${index}:${startMs}:${row.text}`,
    }];
  });
}
