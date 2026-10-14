import type { SearchHit } from "../shared/contract";

export interface LocalTrack {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  file: string;
}

const LOCAL_ID = /^local-[a-f0-9]{12}$/;
const AUDIO_EXT = /\.(mp3|flac|m4a|wav|ogg|aac)$/i;

export function isLocalId(value: string): boolean {
  return LOCAL_ID.test(value);
}

/** Stable id from a path. Same file keeps the same id. */
export function localIdFor(file: string): string {
  let hash = 2166136261;
  for (const char of file) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `local-${(hash >>> 0).toString(16).padStart(8, "0")}cafe`;
}

export function isAudioPath(file: string): boolean {
  return AUDIO_EXT.test(file);
}

export function localHit(track: LocalTrack): SearchHit {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    durationMs: track.durationMs,
    playable: true,
  };
}

/** Case-insensitive match on title and artist. Empty query returns nothing. */
export function searchLocalTracks(tracks: readonly LocalTrack[], keywords: string): SearchHit[] {
  const query = keywords.trim().toLowerCase();
  if (query.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const track of tracks) {
    const hay = `${track.title} ${track.artist}`.toLowerCase();
    if (!hay.includes(query)) continue;
    hits.push(localHit(track));
    if (hits.length >= 40) break;
  }
  return hits;
}

export function titleFromFile(file: string): { title: string; artist: string } {
  const base = file.split(/[\\/]/).pop() ?? file;
  const stem = base.replace(AUDIO_EXT, "").replace(/[_]+/g, " ").trim();
  const parts = stem.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return {
      artist: parts[0]?.slice(0, 200) || "本地",
      title: parts.slice(1).join(" - ").slice(0, 200) || stem.slice(0, 200),
    };
  }
  return { artist: "本地", title: (stem || "未命名").slice(0, 200) };
}
