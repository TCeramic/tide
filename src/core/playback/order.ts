export type RepeatMode = "off" | "all" | "one";

/**
 * Next queue index after the current track finishes or the user skips forward.
 * Shuffle picks another index. Repeat-all wraps. Repeat-one is handled by the caller.
 */
export function followingIndex(
  length: number,
  index: number,
  repeat: RepeatMode,
  shuffle: boolean,
  random: () => number = Math.random,
): number | null {
  if (length <= 0 || index < 0 || index >= length) return null;
  if (shuffle && length > 1) {
    const span = Math.floor(random() * (length - 1));
    if (!Number.isFinite(span)) return null;
    return span >= index ? span + 1 : span;
  }
  const next = index + 1;
  if (next < length) return next;
  if (repeat === "all") return 0;
  return null;
}

export function previousIndex(length: number, index: number, repeat: RepeatMode): number | null {
  if (length <= 0 || index < 0) return null;
  if (index > 0) return index - 1;
  if (repeat === "all") return length - 1;
  return null;
}
