import type { SearchHit } from "../shared/contract";

/** One `playlist_track_all` page. Offset advances until a short page or the cap. */
export const PLAYLIST_PAGE = 100;
export const PLAYLIST_CAP = 2000;

/**
 * Concatenate offset pages. A repeated id stops the walk so a server that
 * ignores offset cannot loop. The cap is about 2000 tracks.
 */
export async function loadPlaylistPages(
  load: (offset: number, limit: number) => Promise<readonly SearchHit[]>,
  cap = PLAYLIST_CAP,
): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  let offset = 0;
  while (hits.length < cap) {
    const page = await load(offset, PLAYLIST_PAGE);
    if (page.length === 0) break;
    let added = 0;
    for (const hit of page) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      hits.push(hit);
      added += 1;
      if (hits.length >= cap) break;
    }
    if (added === 0 || page.length < PLAYLIST_PAGE) break;
    offset += page.length;
  }
  return hits;
}
