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
const SIGNED_OUT_EMPTY = "还没有收听记录。登录后会按听过的歌找相似歌曲，补上今日潮汐 · 探索。";
const LOGGED_IN_EMPTY = "还没有收听记录，相似歌曲也没有找到。";

const TODAY_LIMIT = 28;
const HEARD_CAP = 10;
/** Similar songs below this count may be topped up from daily recommend. Radar is not a source. */
const SIMILAR_TARGET = 8;
const THIN_DISTINCT_PLAYS = 5;

/** Unheard explore tracks come from this NeteaseCloudMusicApi export, not a daily∪radar splice. */
export const SIMILAR_API = "simi_song";
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

export interface TideExploreSources {
  /** Tracks from `simi_song`. This is the unheard pool. */
  similar?: readonly SearchHit[];
  /** Optional spare source. Used only when similar songs are scarce. Not mixed 1:1 with radar. */
  daily?: readonly SearchHit[];
  similarFailed?: boolean;
  signedIn?: boolean;
}

/**
 * 今日潮汐 · 探索. Heard rows come from the listen log.
 * Unheard rows come from similar songs (`simi_song`). Daily recommend can fill
 * only the remainder when that similar list is short. 私人雷达 is not read here.
 */
export function buildTideToday(
  events: readonly ListenEvent[],
  sources: TideExploreSources = {},
): TideTodayList {
  const heard = ranked(events);
  const heardIds = new Set(heard.map((hit) => hit.id));
  const similar = unseen(sources.similar ?? [], heardIds);
  const unheard = [...similar];
  if (unheard.length < SIMILAR_TARGET) {
    const seen = new Set([...heardIds, ...unheard.map((hit) => hit.id)]);
    for (const hit of unseen(sources.daily ?? [], seen)) {
      if (unheard.length >= SIMILAR_TARGET) break;
      unheard.push(hit);
    }
  }

  const heardTake = heard.slice(0, heard.length > 0 && unheard.length > 0 ? HEARD_CAP : TODAY_LIMIT);
  const hits = [...heardTake];
  for (const hit of unheard) {
    if (hits.length >= TODAY_LIMIT) break;
    hits.push(hit);
  }

  if (hits.length === 0) {
    if (sources.similarFailed) {
      return { hits, message: sources.signedIn ? "相似歌曲暂时没有拉到。" : SIGNED_OUT_EMPTY };
    }
    return { hits, message: sources.signedIn ? LOGGED_IN_EMPTY : SIGNED_OUT_EMPTY };
  }
  if (sources.similarFailed && similar.length === 0) {
    return { hits, message: "相似歌曲暂时没有拉到，先按听过的排。" };
  }
  if (heard.length === 0) {
    return { hits, message: "还没有收听记录，这些是按喜欢的歌找到的相似歌曲。" };
  }
  if (similar.length === 0 && (sources.daily ?? []).length > 0) {
    return { hits, message: "相似歌曲不够，后面用每日推荐补了一点。" };
  }
  return { hits, message: null };
}

function unseen(hits: readonly SearchHit[], seen: ReadonlySet<string>): SearchHit[] {
  const rows: SearchHit[] = [];
  const local = new Set(seen);
  for (const hit of hits) {
    if (!isSeedHit(hit) || local.has(hit.id)) continue;
    local.add(hit.id);
    rows.push(hit);
  }
  return rows;
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
