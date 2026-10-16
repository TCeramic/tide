import fs from "node:fs";
import path from "node:path";
import { readTideHits } from "../core/tide-today";
import type { TideToday } from "../shared/contract";

/** One current daily snapshot. Refresh replaces it; old generations are never retained. */
export class TodayStore {
  private snapshot: { day: string; list: TideToday } | null = null;
  private loaded = false;
  constructor(private readonly file?: string) {}

  read(now = new Date()): TideToday | null {
    if (!this.loaded) {
      this.loaded = true;
      if (this.file) try {
        const value = JSON.parse(fs.readFileSync(this.file, "utf8"));
        const hits = readTideHits({ ok: true, hits: value.hits }).slice(0, 20);
        if (typeof value.day === "string" && hits.length) this.snapshot = { day: value.day, list: { ok: true, hits, message: typeof value.message === "string" ? value.message.slice(0, 500) : null } };
      } catch { /* A missing or damaged snapshot is rebuilt. */ }
    }
    return this.snapshot?.day === dayKey(now) ? copy(this.snapshot.list) : null;
  }

  replace(list: TideToday, now = new Date()): void {
    if (!list.hits.length) return;
    const day = dayKey(now), saved = copy({ ...list, hits: list.hits.slice(0, 20) });
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ day, hits: saved.hits, message: saved.message }), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(`${this.file}.tmp`, this.file);
    }
    this.loaded = true;
    this.snapshot = { day, list: saved };
  }
}
function dayKey(date: Date): string { return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`; }
function copy(list: TideToday): TideToday { return { ...list, hits: list.hits.map(hit => ({ ...hit })) }; }
