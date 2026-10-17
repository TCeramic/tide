import fs from "node:fs";
import path from "node:path";
import { customPaletteFromUnknown } from "../core/custom-palette";
import { isAudioLevel, type AudioLevel } from "../core/audio-level";
import { deskSettingsFromUnknown, type DeskLyricsSettings } from "../core/desk-lyrics";
import { mediaShortcutsOrDefault, type MediaShortcutMap } from "../core/media-keys";
import {
  isFontPresetId,
  isPerformanceTier,
  isShellId,
  isStageBackground,
  isThemeId,
  isVisualPresetId,
  type Appearance,
  type FontPresetId,
  type PerformanceTier,
  type ShellId,
  type StageBackground,
  type ThemeId,
  type VisualPresetId,
} from "../shared/contract";

export interface TideSettings extends Appearance {
  volume: number;
  /** `song_url_v1` level. Old files without this field use standard. */
  quality: AudioLevel;
  /** Optional accelerators for drivers that cannot send media keys. Empty means unset. */
  mediaShortcuts: MediaShortcutMap;
  /** When on, Tide registers the four system media keys and other players lose them. */
  captureMediaKeys: boolean;
  deskLyrics: DeskLyricsSettings;
  /** Basename of an imported face under userData/fonts. Empty when unused. */
  fontFile: string;
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
  const lattice = typeof record.lattice === "boolean" ? record.lattice : false;
  const shell: ShellId = isShellId(record.shell) ? record.shell : "lens";
  const preset: VisualPresetId = isVisualPresetId(record.preset) ? record.preset : "flow";
  const performance: PerformanceTier = isPerformanceTier(record.performance) ? record.performance : "balanced";
  const background: StageBackground = isStageBackground(record.background) ? record.background : "paper";
  const fontPreset: FontPresetId = isFontPresetId(record.fontPreset) ? record.fontPreset : "system";
  const fontFamily = typeof record.fontFamily === "string"
    ? record.fontFamily.replace(/[^\w\s,"'-]/g, "").trim().slice(0, 80)
    : "";
  const fontFile = typeof record.fontFile === "string" && /^[\w.-]{1,80}$/.test(record.fontFile) ? record.fontFile : "";
  const quality: AudioLevel = isAudioLevel(record.quality) ? record.quality : "standard";
  const mediaShortcuts = mediaShortcutsOrDefault(record.mediaShortcuts);
  const captureMediaKeys = typeof record.captureMediaKeys === "boolean" ? record.captureMediaKeys : true;
  const deskLyrics = deskSettingsFromUnknown(record.deskLyrics);
  const customPalette = customPaletteFromUnknown(record.customPalette);
  return {
    ...(customPalette ? { customPalette } : {}),
    ...(record.emblem === "liquid-metal" ? {emblem:"liquid-metal" as const} : {}),
    lensMode: record.lensMode === "dark" ? "dark" : record.lensMode === "light" ? "light" : theme === "dusk" ? "dark" : "light",
    latticeMode: record.latticeMode === "light" ? "light" : "dark",
    volume,
    chromeVisible,
    stageLevel,
    theme,
    motion,
    lattice,
    shell,
    preset,
    performance,
    background,
    fontPreset,
    fontFamily,
    quality,
    mediaShortcuts,
    captureMediaKeys,
    deskLyrics,
    fontFile,
  };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export class SettingsStore {
  private cached: TideSettings | null = null;
  private checkedAt = 0;
  constructor(private readonly filePath: string) {}

  read(force = false): TideSettings {
    const now = Date.now();
    if (!force && this.cached && now - this.checkedAt < 1000) return structuredClone(this.cached);
    this.checkedAt = now;
    try {
      this.cached = settingsFromUnknown(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
    } catch {
      this.cached = settingsFromUnknown({});
    }
    return structuredClone(this.cached);
  }

  write(patch: Partial<TideSettings>): TideSettings {
    const settings = settingsFromUnknown({ ...this.read(), ...patch });
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(settings)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    this.cached = settings;
    this.checkedAt = Date.now();
    return settings;
  }
}
