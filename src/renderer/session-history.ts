import type { PlaybackSnapshot, Track } from "../core/playback/types";

/** A real track that entered the playing state. */
export interface SessionHistoryEntry extends Track {
  playedAt: number;
}

export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const HISTORY_KEY = "tide.desktop.recently-played.v1";

/** Local listening history. Only track metadata is persisted, never media URLs or credentials. */
export class SessionHistory {
  private rows: SessionHistoryEntry[] = [];
  private lastPlayingTrackId: string | null = null;

  constructor(private readonly limit = 40, private readonly storage?: HistoryStorage) {
    try {
      const saved: unknown = JSON.parse(storage?.getItem(HISTORY_KEY) ?? "null");
      if (!Array.isArray(saved)) return;
      const ids = new Set<string>();
      this.rows = saved.filter((row): row is SessionHistoryEntry => {
        if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id ||
            typeof row.title !== "string" || typeof row.artist !== "string" ||
            !Number.isFinite(row.durationMs) || row.durationMs < 0 ||
            !Number.isFinite(row.playedAt) || row.playedAt < 0 || row.playedAt > 8.64e15 || ids.has(row.id)) return false;
        ids.add(row.id);
        return true;
      }).slice(0, Math.max(1, limit)).map(metadata);
    } catch { /* Storage may be disabled or contain an older/invalid record. */ }
  }

  observe(snapshot: PlaybackSnapshot, now = Date.now()): boolean {
    if (snapshot.status !== "playing") return false;
    const track = snapshot.index >= 0 ? snapshot.queue[snapshot.index] : undefined;
    if (!track || track.id === this.lastPlayingTrackId) return false;

    this.lastPlayingTrackId = track.id;
    this.rows = [
      metadata({ ...track, playedAt: now }),
      ...this.rows.filter((row) => row.id !== track.id),
    ].slice(0, Math.max(1, this.limit));
    try { this.storage?.setItem(HISTORY_KEY, JSON.stringify(this.rows)); } catch { /* Playback stays available if storage is full. */ }
    return true;
  }

  items(): SessionHistoryEntry[] {
    return this.rows.map((row) => ({ ...row }));
  }
}

function metadata(row: SessionHistoryEntry): SessionHistoryEntry {
  return {
    id: row.id, title: row.title, artist: row.artist,
    durationMs: row.durationMs, playedAt: row.playedAt,
    ...(typeof row.cover === "string" ? { cover: row.cover } : {}),
    ...(typeof row.albumTitle === "string" ? { albumTitle: row.albumTitle } : {}),
    ...(typeof row.albumId === "string" ? { albumId: row.albumId } : {}),
  };
}
