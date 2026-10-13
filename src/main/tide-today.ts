import { buildTideToday, likedTargetFromSession, type ListenEvent } from "../core/tide-today";
import type { SearchHit, TideToday } from "../shared/contract";
import { loopbackJson } from "./session-host";

/**
 * 今日潮汐 · 探索.
 * Unheard tracks are loaded with `simi_song` (`GET /similar`).
 * Daily recommend is only a spare filler when similar songs are scarce.
 * 私人雷达 is not called from here.
 */
export async function loadTideToday(port: number | null, events: readonly ListenEvent[]): Promise<TideToday> {
  const session = port == null ? null : await loopbackJson(port, "GET", "/session");
  const target = likedTargetFromSession(session);
  const heard = new Set(events.filter((event) => event.kind === "play").map((event) => event.id));
  let seeds = [...heard].slice(0, 3);
  if (target.signedIn && seeds.length === 0 && target.playlistId) {
    const liked = await likedTracks(port, target.playlistId);
    seeds = liked.filter((hit) => hit.playable).slice(0, 3).map((hit) => hit.id);
  }

  const similar: SearchHit[] = [];
  let similarFailed = false;
  if (target.signedIn) {
    for (const id of seeds) {
      const body = await loopbackJson(port, "GET", `/similar?id=${encodeURIComponent(id)}`);
      const hits = readHits(body);
      if (!isOk(body)) similarFailed = true;
      similar.push(...hits);
    }
  }

  const unheardSimilar = similar.filter((hit) => !heard.has(hit.id));
  let daily: SearchHit[] = [];
  if (target.signedIn && unheardSimilar.length < 8) {
    const body = await loopbackJson(port, "GET", "/recommend/daily");
    if (isOk(body)) daily = readHits(body);
  }

  const list = buildTideToday(events, {
    similar,
    daily,
    similarFailed,
    signedIn: target.signedIn,
  });
  return { ok: true, hits: list.hits, message: list.message };
}

async function likedTracks(port: number | null, playlistId: string): Promise<SearchHit[]> {
  if (port == null) return [];
  const body = await loopbackJson(port, "GET", `/playlist/tracks?id=${encodeURIComponent(playlistId)}`);
  return readHits(body);
}

function isOk(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && (body as { ok?: unknown }).ok === true);
}

function readHits(body: unknown): SearchHit[] {
  if (!isOk(body)) return [];
  const hits = (body as { hits?: unknown }).hits;
  if (!Array.isArray(hits)) return [];
  const parsed: SearchHit[] = [];
  for (const item of hits) {
    if (!item || typeof item !== "object") continue;
    const hit = item as Record<string, unknown>;
    if (typeof hit.id !== "string" || !/^\d{1,20}$/.test(hit.id)) continue;
    if (typeof hit.title !== "string" || hit.title.length === 0) continue;
    if (typeof hit.artist !== "string" || hit.artist.length === 0) continue;
    if (typeof hit.durationMs !== "number" || !Number.isFinite(hit.durationMs) || hit.durationMs < 0) continue;
    if (typeof hit.playable !== "boolean") continue;
    parsed.push({
      id: hit.id,
      title: hit.title,
      artist: hit.artist,
      durationMs: Math.trunc(hit.durationMs),
      playable: hit.playable,
    });
  }
  return parsed;
}
