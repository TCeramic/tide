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
export async function loadTideToday(port: number | null, events: readonly ListenEvent[], refresh = false, previous: readonly string[] = []): Promise<TideToday> {
  const session = port == null ? null : await loopbackJson(port, "GET", "/session");
  const target = likedTargetFromSession(session);
  const heard = new Set(events.filter((event) => event.kind === "play").map((event) => event.id));
  let seeds = (refresh ? shuffled([...heard]) : [...heard]).slice(0, 6);
  if (target.signedIn && seeds.length === 0 && target.playlistId) {
    const liked = await likedTracks(port, target.playlistId);
    seeds = (refresh ? shuffled(liked) : liked).filter((hit) => hit.playable).slice(0, 6).map((hit) => hit.id);
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
  if (target.signedIn && unheardSimilar.length < 20) {
    const body = await loopbackJson(port, "GET", "/recommend/daily");
    if (isOk(body)) daily = readTideHits(body);
  }

  const list = buildTideToday(events, {
    similar,
    daily,
    similarFailed,
    signedIn: target.signedIn,
  });
  if (refresh) {
    const old = new Set(previous);
    const pool = [...new Map([...list.hits, ...similar, ...daily].filter(hit => hit.playable).map(hit => [hit.id, hit])).values()];
    list.hits = [...shuffled(pool.filter(hit => !old.has(hit.id))), ...shuffled(pool.filter(hit => old.has(hit.id)))].slice(0, 20);
  }
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

function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
