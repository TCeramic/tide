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

export interface LikedPlaylist {
  id: string;
  name: string;
  specialType?: number;
}

export interface LikedTarget {
  signedIn: boolean;
  playlistId: string | null;
}

const LIKED_SPECIAL_TYPE = 5;
const LIKED_SUFFIX = "喜欢的音乐";
const CLASSIC_LIKED_NAME = "我喜欢的音乐";
const SIGNED_OUT_EMPTY = "还没有收听记录。登录后会用「我喜欢的音乐」补上今日潮汐。";
const LOGGED_IN_EMPTY = "还没有收听记录，也没有找到喜欢的音乐。";

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
 * Pick the personal liked playlist.
 * `specialType` 5 wins. Otherwise the nickname form, then 「我喜欢的音乐」,
 * then any name that ends with 「喜欢的音乐」.
 */
export function pickLikedPlaylistId(playlists: readonly LikedPlaylist[], nickname?: string | null): string | null {
  const usable = playlists.filter((playlist) => /^\d{1,20}$/.test(playlist.id) && playlist.name.trim().length > 0);
  const marked = usable.find((playlist) => playlist.specialType === LIKED_SPECIAL_TYPE);
  if (marked) return marked.id;
  const nick = nickname?.trim();
  if (nick) {
    const personal = usable.find((playlist) => playlist.name.trim() === `${nick}${LIKED_SUFFIX}`);
    if (personal) return personal.id;
  }
  const classic = usable.find((playlist) => playlist.name.trim() === CLASSIC_LIKED_NAME);
  if (classic) return classic.id;
  const suffix = usable.find((playlist) => playlist.name.trim().endsWith(LIKED_SUFFIX));
  return suffix?.id ?? null;
}

export function likedTargetFromSession(body: unknown): LikedTarget {
  if (!body || typeof body !== "object") return { signedIn: false, playlistId: null };
  const record = body as { ok?: unknown; state?: unknown; user?: unknown; playlists?: unknown };
  if (record.ok !== true || record.state !== "logged_in" || !Array.isArray(record.playlists)) {
    return { signedIn: false, playlistId: null };
  }
  const nickname = record.user && typeof record.user === "object"
    ? (record.user as { nickname?: unknown }).nickname
    : null;
  const playlists: LikedPlaylist[] = [];
  for (const item of record.playlists) {
    if (!item || typeof item !== "object") continue;
    const playlist = item as { id?: unknown; name?: unknown; specialType?: unknown };
    if (typeof playlist.id !== "string" || typeof playlist.name !== "string") continue;
    const candidate: LikedPlaylist = { id: playlist.id, name: playlist.name };
    if (typeof playlist.specialType === "number" && Number.isInteger(playlist.specialType)) {
      candidate.specialType = playlist.specialType;
    }
    playlists.push(candidate);
  }
  return {
    signedIn: true,
    playlistId: pickLikedPlaylistId(playlists, typeof nickname === "string" ? nickname : null),
  };
}

export function buildTideToday(
  events: readonly ListenEvent[],
  seed: readonly SearchHit[] = [],
  options?: { signedIn?: boolean },
): TideTodayList {
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
    return { hits: [], message: options?.signedIn ? LOGGED_IN_EMPTY : SIGNED_OUT_EMPTY };
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
