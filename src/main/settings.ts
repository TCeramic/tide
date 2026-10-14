import fs from "node:fs";
import path from "node:path";
import { isAudioLevel, type AudioLevel } from "../core/audio-level";
import { deskSettingsFromUnknown, type DeskLyricsSettings } from "../core/desk-lyrics";
import { EMPTY_MEDIA_SHORTCUTS, mediaShortcutsFromUnknown, type MediaShortcutMap } from "../core/media-keys";
import { isThemeId, type Appearance, type ThemeId } from "../shared/contract";

export interface TideSettings extends Appearance {
  volume: number;
  /** `song_url_v1` level. Old files without this field use standard. */
  quality: AudioLevel;
  /** Optional accelerators for drivers that cannot send media keys. Empty means unset. */
  mediaShortcuts: MediaShortcutMap;
  /** When on, Tide registers the four system media keys and other players lose them. */
  captureMediaKeys: boolean;
  deskLyrics: DeskLyricsSettings;
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
  const theme: ThemeId = isThemeId(record.theme) ? record.theme : "tide";
  const motion = typeof record.motion === "number" && Number.isFinite(record.motion)
    ? clamp(record.motion)
    : 1;
  const quality: AudioLevel = isAudioLevel(record.quality) ? record.quality : "standard";
  const mediaShortcuts = mediaShortcutsFromUnknown(record.mediaShortcuts);
  const captureMediaKeys = typeof record.captureMediaKeys === "boolean" ? record.captureMediaKeys : true;
  const deskLyrics = deskSettingsFromUnknown(record.deskLyrics);
  return { volume, chromeVisible, stageLevel, theme, motion, quality, mediaShortcuts, captureMediaKeys, deskLyrics };
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
      return { volume: DEFAULT_VOLUME, chromeVisible: true, stageLevel: 1, theme: "tide", motion: 1, quality: "standard", mediaShortcuts: { ...EMPTY_MEDIA_SHORTCUTS }, captureMediaKeys: true, deskLyrics: deskSettingsFromUnknown(undefined) };
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
