/** In-memory liked ids. Unknown until `likelist` has been read. */

type Listener = () => void;

const listeners = new Set<Listener>();
let known = false;
const ids = new Set<string>();

export function isLiked(id: string, hint?: boolean): boolean {
  if (known) return ids.has(id);
  return hint === true;
}

export function setLikedIds(next: readonly string[], isKnown: boolean): void {
  known = isKnown;
  ids.clear();
  if (isKnown) {
    for (const id of next) ids.add(id);
  }
  emit();
}

export function applyLike(id: string, liked: boolean): void {
  if (known && ids.has(id) === liked) return;
  known = true;
  if (liked) ids.add(id);
  else ids.delete(id);
  emit();
}

export function onLiked(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) listener();
}
