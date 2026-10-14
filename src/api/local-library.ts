import fs from "node:fs";
import path from "node:path";
import {
  isAudioPath,
  isLocalId,
  localIdFor,
  localHit,
  searchLocalTracks,
  titleFromFile,
  type LocalTrack,
} from "../core/local-library";
import type { SearchHit } from "../shared/contract";

/** On-disk index of files the user added. The file never stores a cookie. */
export class LocalLibrary {
  constructor(private readonly filePath: string) {}

  read(): LocalTrack[] {
    if (this.filePath.length === 0) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as unknown;
      const rows = parsed && typeof parsed === "object" ? (parsed as { tracks?: unknown }).tracks : undefined;
      if (!Array.isArray(rows)) return [];
      return rows.flatMap((row) => {
        const track = readTrack(row);
        return track ? [track] : [];
      });
    } catch {
      return [];
    }
  }

  find(id: string): LocalTrack | null {
    if (!isLocalId(id)) return null;
    return this.read().find((track) => track.id === id) ?? null;
  }

  search(keywords: string): SearchHit[] {
    return searchLocalTracks(this.read(), keywords);
  }

  list(): SearchHit[] {
    return this.read().map(localHit);
  }

  add(files: readonly string[]): SearchHit[] {
    if (this.filePath.length === 0) return [];
    const known = this.read();
    const seen = new Set(known.map((track) => path.resolve(track.file)));
    for (const file of files) {
      if (typeof file !== "string" || file.length === 0 || file.length > 1024) continue;
      const resolved = path.resolve(file);
      if (!isAudioPath(resolved) || seen.has(resolved)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(resolved);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const named = titleFromFile(resolved);
      known.push({
        id: localIdFor(resolved),
        title: named.title,
        artist: named.artist,
        durationMs: 0,
        file: resolved,
      });
      seen.add(resolved);
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ tracks: known })}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    return known.map(localHit);
  }
}

function readTrack(value: unknown): LocalTrack | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !isLocalId(record.id)) return null;
  if (typeof record.title !== "string" || record.title.trim().length === 0) return null;
  if (typeof record.artist !== "string" || record.artist.trim().length === 0) return null;
  if (typeof record.file !== "string" || record.file.length === 0) return null;
  const durationMs = typeof record.durationMs === "number" && Number.isFinite(record.durationMs) ? record.durationMs : 0;
  return {
    id: record.id,
    title: record.title.trim().slice(0, 200),
    artist: record.artist.trim().slice(0, 200),
    durationMs: Math.max(0, Math.trunc(durationMs)),
    file: record.file,
  };
}
