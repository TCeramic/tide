import type { SearchHit } from "../shared/contract";

/** Pull more songs when this many playable tracks remain after the current one. */
export const EXPLORE_REMAINING = 3;
export const EXPLORE_BATCH = 8;

/**
 * Spotify-style radio continuation.
 * Callers must pass tracks from a similar/related API (`simi_song`).
 * This module never reads 每日推荐.
 */
export function shouldExtendQueue(queueLength: number, index: number): boolean {
  if (queueLength <= 0 || index < 0 || index >= queueLength) return false;
  return queueLength - index - 1 <= EXPLORE_REMAINING;
}

/** Current track, then up to three tracks just played. */
export function exploreSeedIds(ids: readonly string[], index: number): string[] {
  const seeds: string[] = [];
  for (let cursor = index; cursor >= 0 && seeds.length < 4; cursor -= 1) {
    const id = ids[cursor];
    if (id && !seeds.includes(id)) seeds.push(id);
  }
  return seeds;
}

export function pickExploreAdditions(
  similar: readonly SearchHit[],
  queuedIds: ReadonlySet<string>,
  limit = EXPLORE_BATCH,
): SearchHit[] {
  const added: SearchHit[] = [];
  const seen = new Set(queuedIds);
  for (const hit of similar) {
    if (!hit.playable || seen.has(hit.id)) continue;
    if (!/^\d{1,20}$/.test(hit.id)) continue;
    seen.add(hit.id);
    added.push(hit);
    if (added.length >= limit) break;
  }
  return added;
}
