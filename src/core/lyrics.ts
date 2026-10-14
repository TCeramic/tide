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

/** Stack a translation under the original line when their stamps are close. */
export function pairLyrics(original: readonly LyricLine[], translation: readonly LyricLine[]): LyricPair[] {
  return original.map((line) => {
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
      translation: bestDelta <= PAIR_WINDOW_MS ? best : "",
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
