import fs from "node:fs";
import path from "node:path";
import type { ListenEvent, ListenKind } from "../core/tide-today";
import type { Track } from "../core/playback/types";

const MAX_EVENTS = 400;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

/** Play and skip history under userData. The file never stores a cookie. */
export class ListenLog {
  constructor(private readonly filePath: string) {}

  read(): ListenEvent[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as unknown;
      const events = parsed && typeof parsed === "object" ? (parsed as { events?: unknown }).events : undefined;
      if (!Array.isArray(events)) return [];
      return events.flatMap((item) => {
        const event = readEvent(item);
        return event ? [event] : [];
      });
    } catch {
      return [];
    }
  }

  append(kind: ListenKind, track: Track): void {
    const event = readEvent({
      id: track.id,
      title: track.title,
      artist: track.artist,
      durationMs: track.durationMs,
      at: Date.now(),
      kind,
    });
    if (!event) return;
    const events = [...this.read(), event].slice(-MAX_EVENTS);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ events })}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }
}

function readEvent(value: unknown): ListenEvent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !/^\d{1,20}$/.test(record.id)) return null;
  if (typeof record.title !== "string" || record.title.trim().length === 0) return null;
  if (typeof record.artist !== "string" || record.artist.trim().length === 0) return null;
  if (typeof record.durationMs !== "number" || !Number.isFinite(record.durationMs)) return null;
  if (record.durationMs < 0 || record.durationMs > MAX_DURATION_MS) return null;
  if (typeof record.at !== "number" || !Number.isFinite(record.at)) return null;
  if (record.kind !== "play" && record.kind !== "skip") return null;
  return {
    id: record.id,
    title: record.title.trim().slice(0, 200),
    artist: record.artist.trim().slice(0, 200),
    durationMs: Math.trunc(record.durationMs),
    at: record.at,
    kind: record.kind,
  };
}
