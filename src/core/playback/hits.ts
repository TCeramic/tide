import type { SearchHit } from "../../shared/contract";
import type { Track } from "./types";

/** Playable search rows become the queue. A gray row does not replace it. */
export function queueFromHits(
  hits: readonly SearchHit[],
  index: number,
): { tracks: Track[]; index: number } | null {
  if (!Number.isInteger(index) || index < 0 || index >= hits.length) return null;
  if (!hits[index]?.playable) return null;
  const tracks: Track[] = [];
  let queueIndex = -1;
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    if (!hit?.playable) continue;
    if (i === index) queueIndex = tracks.length;
    tracks.push({
      id: hit.id,
      title: hit.title,
      artist: hit.artist,
      durationMs: hit.durationMs,
    });
  }
  if (queueIndex < 0) return null;
  return { tracks, index: queueIndex };
}
