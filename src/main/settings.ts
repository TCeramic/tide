import fs from "node:fs";
import path from "node:path";

export interface TideSettings {
  volume: number;
}

const DEFAULT_VOLUME = 0.8;

/** Volume only. Cookies and other secrets never belong in this file. */
export function settingsFromUnknown(value: unknown): TideSettings {
  const volume = value && typeof value === "object" ? (value as { volume?: unknown }).volume : undefined;
  if (typeof volume !== "number" || !Number.isFinite(volume)) return { volume: DEFAULT_VOLUME };
  return { volume: Math.min(1, Math.max(0, volume)) };
}

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  read(): TideSettings {
    try {
      return settingsFromUnknown(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
    } catch {
      return { volume: DEFAULT_VOLUME };
    }
  }

  write(volume: number): void {
    const settings = settingsFromUnknown({ volume });
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(settings)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }
}
