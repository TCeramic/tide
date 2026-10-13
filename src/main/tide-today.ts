import { buildTideToday, isThin, likedTargetFromSession, type ListenEvent } from "../core/tide-today";
import { loopbackJson } from "./session-host";
import type { SearchHit, TideToday } from "../shared/contract";

export async function loadTideToday(port: number | null, events: readonly ListenEvent[]): Promise<TideToday> {
  if (!isThin(events)) {
    const list = buildTideToday(events, []);
    return { ok: true, hits: list.hits, message: list.message };
  }
  const session = port == null ? null : await loopbackJson(port, "GET", "/session");
  const target = likedTargetFromSession(session);
  const seed = target.playlistId ? await likedTracks(port, target.playlistId) : [];
  const list = buildTideToday(events, seed, { signedIn: target.signedIn });
  return { ok: true, hits: list.hits, message: list.message };
}

async function likedTracks(port: number | null, playlistId: string): Promise<SearchHit[]> {
  if (port == null) return [];
  const body = await loopbackJson(port, "GET", `/playlist/tracks?id=${encodeURIComponent(playlistId)}`);
  return readHits(body);
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
