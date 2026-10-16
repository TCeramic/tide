import { buildTideToday, likedTargetFromSession, readTideHits, type ListenEvent } from "../core/tide-today";
import type { SearchHit, TideToday } from "../shared/contract";
import { loopbackJson } from "./session-host";
import { normalizeArtworkUrl } from "../core/artwork";

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
      const hits = readTideHits(body);
      if (!isOk(body)) similarFailed = true;
      similar.push(...hits);
    }
  }

  const unheardSimilar = similar.filter((hit) => !heard.has(hit.id));
  let daily: SearchHit[] = [];
  if (target.signedIn && unheardSimilar.length < 8) {
    const body = await loopbackJson(port, "GET", "/recommend/daily");
    if (isOk(body)) daily = readTideHits(body);
  }

  const list = buildTideToday(events, {
    similar,
    daily,
    similarFailed,
    signedIn: target.signedIn,
  });
  const missing = list.hits.filter(hit => !hit.cover).map(hit => hit.id);
  if (port != null && missing.length > 0) {
    const response = await loopbackJson(port, "GET", `/artwork?ids=${missing.join(",")}`).catch(() => null);
    const covers = response && typeof response === "object" ? (response as { covers?: Record<string, unknown> }).covers : null;
    if (covers && typeof covers === "object") for (const hit of list.hits) {
      const cover = normalizeArtworkUrl(covers[hit.id]);
      if (!hit.cover && cover) hit.cover = cover;
    }
  }
  return { ok: true, hits: list.hits, message: list.message };
}

async function likedTracks(port: number | null, playlistId: string): Promise<SearchHit[]> {
  if (port == null) return [];
  const body = await loopbackJson(port, "GET", `/playlist/tracks?id=${encodeURIComponent(playlistId)}`);
  return readTideHits(body);
}

function isOk(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && (body as { ok?: unknown }).ok === true);
}
