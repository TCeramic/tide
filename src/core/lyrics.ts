import type { LyricWord, YrcLine } from "../shared/contract";

export interface LyricLine {
  timeMs: number;
  text: string;
}

const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/** Parse an LRC blob. Lines with no stamp are dropped. A missing lyric is an empty list. */
export function parseLrc(source: string | null | undefined): LyricLine[] {
  if (!source) return [];
  const lines: LyricLine[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const stamps: number[] = [];
    raw.replace(STAMP, (_match, minutes: string, seconds: string, fraction?: string) => {
      const fractionMs = fraction == null
        ? 0
        : Math.round(Number(fraction.padEnd(3, "0").slice(0, 3)));
      stamps.push((Number(minutes) * 60 + Number(seconds)) * 1000 + fractionMs);
      return "";
    });
    const text = raw.replace(STAMP, "").trim();
    if (text.length === 0) continue;
    for (const timeMs of stamps) {
      if (Number.isFinite(timeMs) && timeMs >= 0) lines.push({ timeMs, text: text.slice(0, 400) });
    }
  }
  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines;
}

export const LYRIC_OFFSET_STEP_MS = 500;
export const LYRIC_OFFSET_LIMIT_MS = 10_000;

/** +0.5s looks ahead, so a late lyric line can be pulled forward. */
export function lyricPosition(positionMs: number, offsetMs: number): number {
  if (!Number.isFinite(positionMs)) return 0;
  const offset = Number.isFinite(offsetMs) ? offsetMs : 0;
  return Math.max(0, positionMs + offset);
}

export function nextLyricOffset(current: number, direction: -1 | 1): number {
  const base = Number.isFinite(current) ? current : 0;
  const next = base + direction * LYRIC_OFFSET_STEP_MS;
  return Math.max(-LYRIC_OFFSET_LIMIT_MS, Math.min(LYRIC_OFFSET_LIMIT_MS, next));
}

export function currentLyricIndex(lines: readonly LyricLine[], positionMs: number): number {
  if (!Number.isFinite(positionMs)) return -1;
  let index = -1;
  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    if (lines[cursor].timeMs <= positionMs) index = cursor;
    else break;
  }
  return index;
}

export interface LyricPair {
  timeMs: number;
  original: string;
  translation: string;
}

const PAIR_WINDOW_MS = 1_500;

const CREDIT_LINE = /^(?:作词|作曲|编曲|制作人|出品人?|原唱|翻唱|吉他|贝斯|鼓|和声|录音|混音|母带|监制)\s*[:：]/;

export function isCreditLine(text: string): boolean {
  return CREDIT_LINE.test(text.trim());
}

/** Stack a translation under the original line when their stamps are close. Credits stay untranslated. */
export function pairLyrics(original: readonly LyricLine[], translation: readonly LyricLine[]): LyricPair[] {
  return original.map((line) => {
    if (isCreditLine(line.text)) {
      return { timeMs: line.timeMs, original: line.text, translation: "" };
    }
    let best = "";
    let bestDelta = PAIR_WINDOW_MS + 1;
    for (const row of translation) {
      const delta = Math.abs(row.timeMs - line.timeMs);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = row.text;
      }
    }
    return {
      timeMs: line.timeMs,
      original: line.text,
      translation: bestDelta <= PAIR_WINDOW_MS && !isCreditLine(best) ? best : "",
    };
  });
}

export interface DeskLineCue {
  title: string;
  previous: string;
  current: string;
  translation: string;
  next: string;
  empty: boolean;
}

/** Current desktop-lyric frame. An empty lyric keeps the title and no blank translation row. */
export function deskLineCue(
  original: readonly LyricLine[],
  translation: readonly LyricLine[],
  positionMs: number,
  offsetMs: number,
  title: string,
): DeskLineCue {
  const pairs = pairLyrics(original, translation);
  const safeTitle = title.trim().slice(0, 200);
  if (pairs.length === 0) {
    return { title: safeTitle, previous: "", current: "", translation: "", next: "", empty: true };
  }
  const index = currentLyricIndex(
    pairs.map((row) => ({ timeMs: row.timeMs, text: row.original })),
    lyricPosition(positionMs, offsetMs),
  );
  const at = (cursor: number) => (cursor >= 0 && cursor < pairs.length ? pairs[cursor] : undefined);
  const current = at(index);
  return {
    title: safeTitle,
    previous: at(index - 1)?.original ?? "",
    current: current?.original ?? "",
    translation: current?.translation ?? "",
    next: at(index + 1)?.original ?? "",
    empty: false,
  };
}

const YRC_LINE = /^\[(\d+),(\d+)\](.*)$/;

/**
 * Parse a NetEase YRC blob.
 * Lines look like `[startMs,durMs](startMs,durMs,0)字`.
 * JSON credit rows are skipped. A line with no words stays line-level.
 */
export function parseYrc(source: string | null | undefined): YrcLine[] {
  if (!source) return [];
  const lines: YrcLine[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith("{")) continue;
    const header = YRC_LINE.exec(trimmed);
    if (!header) continue;
    const timeMs = Number(header[1]);
    const durationMs = Number(header[2]);
    if (!Number.isFinite(timeMs) || !Number.isFinite(durationMs) || durationMs < 0) continue;
    const words: LyricWord[] = [];
    const body = header[3] ?? "";
    const wordPattern = /\((\d+),(\d+),\d+\)([^(\r\n]*)/g;
    for (const match of body.matchAll(wordPattern)) {
      let wordStart = Number(match[1]);
      const wordDur = Number(match[2]);
      const text = (match[3] ?? "").replace(/\s+/g, " ");
      if (!Number.isFinite(wordStart) || !Number.isFinite(wordDur) || wordDur < 0) continue;
      if (text.trim().length === 0) continue;
      if (wordStart + 500 < timeMs) wordStart += timeMs;
      words.push({
        timeMs: wordStart,
        durationMs: Math.max(1, Math.trunc(wordDur)),
        text: text.slice(0, 80),
      });
    }
    const text = words.length > 0
      ? words.map((word) => word.text).join("")
      : body.replace(/\((\d+),(\d+),\d+\)/g, "").trim();
    if (text.length === 0) continue;
    lines.push({
      timeMs: Math.trunc(timeMs),
      durationMs: Math.max(1, Math.trunc(durationMs)),
      text: text.slice(0, 400),
      words,
    });
  }
  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines;
}

/** 0 before the word, 1 after it, linear inside. */
export function wordFill(word: LyricWord, positionMs: number): number {
  if (!Number.isFinite(positionMs)) return 0;
  if (positionMs >= word.timeMs + word.durationMs) return 1;
  if (positionMs <= word.timeMs) return 0;
  return (positionMs - word.timeMs) / Math.max(1, word.durationMs);
}

/**
 * Karaoke sweep across one line, weighted by measured glyph width.
 * Widths come from the renderer; tests can pass their own measurements.
 * Progress never leaves the current line.
 */
export function sweepProgress(words: readonly LyricWord[], widths: readonly number[], positionMs: number): number {
  if (words.length === 0) return 0;
  let total = 0;
  const spans: number[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const width = widths[index];
    const span = Number.isFinite(width) && width > 0 ? width : Math.max(1, words[index]?.text.length ?? 1);
    spans.push(span);
    total += span;
  }
  if (total <= 0) return 0;
  let cursor = 0;
  let progress = 0;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!word) continue;
    const span = spans[index] ?? 1;
    const fill = wordFill(word, positionMs);
    progress = (cursor + span * fill) / total;
    cursor += span;
    if (fill < 1) break;
  }
  return Math.min(1, Math.max(0, progress));
}

/** Gentle line fill when a row has no word times. Smoothstep across the line. */
export function lineEase(positionMs: number, startMs: number, endMs: number): number {
  if (!Number.isFinite(positionMs) || !Number.isFinite(startMs)) return 0;
  const end = Number.isFinite(endMs) && endMs > startMs ? endMs : startMs + 4000;
  const raw = (positionMs - startMs) / (end - startMs);
  const clamped = Math.min(1, Math.max(0, raw));
  return clamped * clamped * (3 - 2 * clamped);
}
