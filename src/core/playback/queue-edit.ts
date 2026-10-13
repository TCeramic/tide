import type { Track } from "./types";

export interface QueueEdit {
  queue: Track[];
  index: number;
  /** The track under the playhead changed, so audio has to load again. */
  trackChanged: boolean;
}

function clone(track: Track): Track {
  return { id: track.id, title: track.title, artist: track.artist, durationMs: track.durationMs };
}

/** Drop one row. Removing the current row keeps the playhead on what is now in that slot. */
export function removeQueueItem(queue: readonly Track[], current: number, index: number): QueueEdit | null {
  if (!Number.isInteger(index) || index < 0 || index >= queue.length) return null;
  const next = queue.filter((_, cursor) => cursor !== index).map(clone);
  if (next.length === 0) return { queue: [], index: -1, trackChanged: current >= 0 };
  let nextIndex = current;
  if (index < current) nextIndex -= 1;
  else if (index === current) nextIndex = Math.min(index, next.length - 1);
  if (nextIndex < 0 || nextIndex >= next.length) nextIndex = 0;
  return {
    queue: next,
    index: nextIndex,
    trackChanged: queue[current]?.id !== next[nextIndex]?.id,
  };
}

/** Move one row. The playhead follows the track that was current. */
export function moveQueueItem(queue: readonly Track[], current: number, from: number, to: number): QueueEdit | null {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 0 || to < 0 || from >= queue.length || to >= queue.length || from === to) return null;
  const next = queue.map(clone);
  const [item] = next.splice(from, 1);
  if (!item) return null;
  next.splice(to, 0, item);
  let nextIndex = current;
  if (current === from) nextIndex = to;
  else if (from < current && to >= current) nextIndex -= 1;
  else if (from > current && to <= current) nextIndex += 1;
  if (nextIndex < 0 || nextIndex >= next.length) nextIndex = 0;
  return {
    queue: next,
    index: nextIndex,
    trackChanged: queue[current]?.id !== next[nextIndex]?.id,
  };
}
