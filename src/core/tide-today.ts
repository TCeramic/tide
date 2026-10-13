import type { SearchHit } from "../shared/contract";

export type ListenKind = "play" | "skip";

/** One local listening signal. No cookies or account secrets. */
export interface ListenEvent {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  at: number;
  kind: ListenKind;
}

export interface TideTodayList {
  hits: SearchHit[];
  message: string | null;
}

const TODAY_LIMIT = 20;
const THIN_DISTINCT_PLAYS = 5;
/** Leaving a track before this point counts as a skip. */
export const SKIP_WITHIN_MS = 30_000;

export function countsAsSkip(status: string, positionMs: number): boolean {
  return (status === "playing" || status === "loading")
    && Number.isFinite(positionMs)
    && positionMs < SKIP_WITHIN_MS;
}

export function isThin(events: readonly ListenEvent[]): boolean {
  const played = new Set<string>();
  for (const event of events) {
    if (event.kind === "play" && event.id) played.add(event.id);
  }
  return played.size < THIN_DISTINCT_PLAYS;
}

/**
 * Rank tracks from local play/skip events.
 * When fewer than five distinct tracks have been played, fill from a liked-playlist seed.
 */
export function buildTideToday(events: readonly ListenEvent[], seed: readonly SearchHit[] = []): TideTodayList {
  const local = ranked(events).slice(0, TODAY_LIMIT);
  if (!isThin(events)) {
    if (local.length === 0) {
      return { hits: [], message: "这些记录里跳过得比较多，今天先不排。" };
    }
    return { hits: local, message: null };
  }

  const hits = [...local];
  const seen = new Set(hits.map((hit) => hit.id));
  for (const hit of seed) {
    if (hits.length >= TODAY_LIMIT) break;
    if (!isSeedHit(hit) || seen.has(hit.id)) continue;
    seen.add(hit.id);
    hits.push(hit);
  }

  if (hits.length === 0) {
    return { hits: [], message: "还没有收听记录。登录后会用「我喜欢的音乐」补上今日潮汐。" };
  }
  if (seed.length === 0) {
    return { hits, message: "听得还不多，也没有找到「我喜欢的音乐」。" };
  }
  if (local.length === 0) {
    return { hits, message: "听得还不多，先从「我喜欢的音乐」里放了这些。" };
  }
  return { hits, message: "听得还不多，后面用「我喜欢的音乐」补上。" };
}

function ranked(events: readonly ListenEvent[]): SearchHit[] {
  const rows = new Map<string, { plays: number; skips: number; at: number; hit: SearchHit }>();
  const ordered = [...events].sort((a, b) => a.at - b.at);
  for (const event of ordered) {
    const hit = eventHit(event);
    if (!hit) continue;
    const row = rows.get(hit.id) ?? { plays: 0, skips: 0, at: event.at, hit };
    if (event.kind === "play") row.plays += 1;
    else row.skips += 1;
    row.at = event.at;
    row.hit = hit;
    rows.set(hit.id, row);
  }
  return [...rows.values()]
    .filter((row) => row.plays > row.skips)
    .sort((a, b) => (b.plays - b.skips) - (a.plays - a.skips) || b.at - a.at)
    .map((row) => row.hit);
}

function eventHit(event: ListenEvent): SearchHit | null {
  if (!/^\d{1,20}$/.test(event.id)) return null;
  if (!event.title || !event.artist) return null;
  if (!Number.isFinite(event.durationMs) || event.durationMs < 0) return null;
  return {
    id: event.id,
    title: event.title,
    artist: event.artist,
    durationMs: Math.trunc(event.durationMs),
    playable: true,
  };
}

function isSeedHit(hit: SearchHit): boolean {
  return /^\d{1,20}$/.test(hit.id) && hit.title.length > 0 && hit.artist.length > 0 && hit.durationMs >= 0;
}
