import { parseTtml } from "../core/ttml";
import type { LyricBundle } from "./netease";

export const AMLL_DB = "https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main/ncm-lyrics/";
const lrc = (rows: { timeMs: number; text: string }[]) => rows.map(row => `[${String(Math.floor(row.timeMs / 60000)).padStart(2, "0")}:${(row.timeMs % 60000 / 1000).toFixed(3).padStart(6, "0")}]${row.text}`).join("\n");

/** Exact NetEase IDs only; no fuzzy title match that could silently attach another recording. */
export function createCommunityLyrics(fetcher: typeof fetch = fetch): (id: string) => Promise<LyricBundle | null> {
  const cache = new Map<string, { until: number; value: LyricBundle | null }>();
  const pending = new Map<string, Promise<LyricBundle | null>>();
  const load = async (id: string): Promise<LyricBundle | null> => {
    let value: LyricBundle | null = null;
    try {
      const response = await fetcher(`${AMLL_DB}${id}.ttml`, { signal: AbortSignal.timeout(4500) });
      if (response.ok && Number(response.headers.get("content-length") ?? 0) <= 2_000_000) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty community response");
        const chunks: Uint8Array[] = []; let size = 0;
        for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error("Community response too large"); } chunks.push(next.value); }
        const parsed = parseTtml(Buffer.concat(chunks).toString("utf8"));
        if (parsed.yrc.some(row => row.words.length > 0)) value = {
          lyric: lrc(parsed.lines), translation: lrc(parsed.translation), romaji: lrc(parsed.romaji),
          yrc: parsed.yrc.map(row => `[${row.timeMs},${row.durationMs}]${row.words.length ? row.words.map(word => `(${word.timeMs},${word.durationMs},0)${word.text}`).join("") : row.text}`).join("\n"),
          ytlrc: "", source: "amll", credits: parsed.credits,
        };
      }
    } catch { /* Community availability never breaks playback or ordinary lyrics. */ }
    cache.set(id, { until: Date.now() + (value ? 86_400_000 : 600_000), value });
    while (cache.size > 64) cache.delete(cache.keys().next().value!);
    return value;
  };
  return id => {
    if (!/^\d{1,20}$/.test(id)) return Promise.resolve(null);
    const entry = cache.get(id); if (entry && entry.until > Date.now()) return Promise.resolve(entry.value);
    if (!pending.has(id)) pending.set(id, load(id).finally(() => pending.delete(id)));
    return pending.get(id)!;
  };
}
