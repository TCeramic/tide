import { buildTideToday, isThin, type ListenEvent } from "../core/tide-today";
import { loopbackJson } from "./session-host";
import type { SearchHit, TideToday } from "../shared/contract";

const LIKED_NAME = "我喜欢的音乐";

export async function loadTideToday(port: number | null, events: readonly ListenEvent[]): Promise<TideToday> {
  const seed = isThin(events) ? await likedSeed(port) : [];
  const list = buildTideToday(events, seed);
  return { ok: true, hits: list.hits, message: list.message };
}

async function likedSeed(port: number | null): Promise<SearchHit[]> {
  if (port == null) return [];
  const session = await loopbackJson(port, "GET", "/session");
  const likedId = likedPlaylistId(session);
  if (!likedId) return [];
  const body = await loopbackJson(port, "GET", `/playlist/tracks?id=${encodeURIComponent(likedId)}`);
  return readHits(body);
}

function likedPlaylistId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { ok?: unknown; state?: unknown; playlists?: unknown };
  if (record.ok !== true || record.state !== "logged_in" || !Array.isArray(record.playlists)) return null;
  for (const item of record.playlists) {
    if (!item || typeof item !== "object") continue;
    const playlist = item as { id?: unknown; name?: unknown };
    if (playlist.name === LIKED_NAME && typeof playlist.id === "string" && /^\d{1,20}$/.test(playlist.id)) {
      return playlist.id;
    }
  }
  return null;
}

function readHits(body: unknown): SearchHit[] {
  if (!body || typeof body !== "object") return [];
  const hits = (body as { ok?: unknown; hits?: unknown }).hits;
  if ((body as { ok?: unknown }).ok !== true || !Array.isArray(hits)) return [];
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
    if (parsed.length >= 20) break;
  }
  return parsed;
}
