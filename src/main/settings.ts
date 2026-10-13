import fs from "node:fs";
import path from "node:path";

export interface TideSettings {
  volume: number;
  chromeVisible: boolean;
  stageLevel: number;
}

const DEFAULT_VOLUME = 0.8;

/** Volume and local UI knobs. Cookies and other secrets never belong in this file. */
export function settingsFromUnknown(value: unknown): TideSettings {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const volume = typeof record.volume === "number" && Number.isFinite(record.volume)
    ? clamp(record.volume)
    : DEFAULT_VOLUME;
  const chromeVisible = typeof record.chromeVisible === "boolean" ? record.chromeVisible : true;
  const stageLevel = typeof record.stageLevel === "number" && Number.isFinite(record.stageLevel)
    ? clamp(record.stageLevel)
    : 1;
  return { volume, chromeVisible, stageLevel };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  read(): TideSettings {
    try {
      return settingsFromUnknown(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
    } catch {
      return { volume: DEFAULT_VOLUME, chromeVisible: true, stageLevel: 1 };
    }
  }

  write(patch: Partial<TideSettings>): TideSettings {
    const settings = settingsFromUnknown({ ...this.read(), ...patch });
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(settings)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    return settings;
  }
}
