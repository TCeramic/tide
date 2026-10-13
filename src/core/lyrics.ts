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
