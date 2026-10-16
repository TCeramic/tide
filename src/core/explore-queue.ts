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

/**
 * Sequential inspiration waits until the current playlist's last track.
 * Shuffle inspiration can extend as soon as the queue runs short.
 * List repeat and single repeat do not append.
 */
export function shouldInspireNow(
  queueLength: number,
  index: number,
  repeat: "off" | "all" | "one",
  shuffle: boolean,
  explore: boolean,
): boolean {
  if (!explore || queueLength <= 0 || index < 0 || index >= queueLength) return false;
  if (shuffle) return shouldExtendQueue(queueLength, index);
  if (repeat !== "off") return false;
  return index === queueLength - 1;
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

/** Stratified rotating sample over the whole source list, plus extra liked-song votes. */
export function profileSeeds(hits: readonly { id: string; liked?: boolean }[], liked: ReadonlySet<string>, round = 0): Array<{ id: string; weight: number }> {
  const valid = [...new Map(hits.filter(h => /^\d{1,20}$/.test(h.id)).map(h => [h.id, h])).values()];
  const selected = new Map<string, number>();
  const count = Math.min(8, valid.length);
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * valid.length / count), end = Math.floor((i + 1) * valid.length / count);
    const hit = valid[start + round % Math.max(1, end - start)];
    selected.set(hit.id, liked.has(hit.id) || hit.liked ? 3 : 1);
  }
  const favorites = valid.filter(h => liked.has(h.id) || h.liked);
  for (let i = 0; i < Math.min(4, favorites.length); i++) {
    const hit = favorites[(round * 4 + i) % favorites.length]; selected.set(hit.id, 3);
  }
  return [...selected].map(([id, weight]) => ({ id, weight }));
}

export function rankProfileMatches(groups: readonly { weight: number; hits: readonly SearchHit[] }[]): SearchHit[] {
  const votes = new Map<string, { hit: SearchHit; score: number }>();
  for (const group of groups) {
    const seen = new Set<string>();
    group.hits.forEach((hit, rank) => {
      if (!hit.playable || seen.has(hit.id)) return;
      seen.add(hit.id);
      const prior = votes.get(hit.id) ?? { hit, score: 0 };
      prior.score += group.weight / (1 + rank * .12); votes.set(hit.id, prior);
    });
  }
  return [...votes.values()].sort((a, b) => b.score - a.score).map(v => v.hit);
}
/** Draw one candidate using all profile votes rather than always taking the highest score. */
export function randomProfileMatch(groups: readonly { weight: number; hits: readonly SearchHit[] }[], queued: ReadonlySet<string>, recent: ReadonlySet<string>, random = Math.random): SearchHit | null {
  const candidates = rankProfileMatches(groups).filter(hit => hit.playable && /^\d{1,20}$/.test(hit.id) && !queued.has(hit.id));
  const fresh = candidates.filter(hit => !recent.has(hit.id));
  const pool = fresh.length ? fresh : candidates;
  const weighted = pool.map(hit => ({ hit, weight: groups.reduce((sum, group) => { const rank = group.hits.findIndex(row => row.id === hit.id); return sum + (rank < 0 ? 0 : group.weight / (1 + rank * .12)); }, 0) }));
  let remaining = Math.min(.999999999, Math.max(0, random())) * weighted.reduce((sum, row) => sum + row.weight, 0);
  for (const row of weighted) { remaining -= row.weight; if (remaining < 0) return row.hit; }
  return weighted.at(-1)?.hit ?? null;
}
