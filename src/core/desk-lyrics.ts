/** Desktop-lyric window placement and appearance. No default edge snap. */

export interface DeskArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DeskLyricsSettings {
  open: boolean;
  locked: boolean;
  x: number | null;
  y: number | null;
  fontSize: number;
  color: string;
  opacity: number;
}

export const DESK_LOCK_ACCELERATOR = "CommandOrControl+Alt+L";

export const DEFAULT_DESK_LYRICS: DeskLyricsSettings = {
  open: false,
  locked: false,
  x: null,
  y: null,
  fontSize: 32,
  color: "#f7fbfc",
  opacity: 1,
};

const FONT_MIN = 18;
const FONT_MAX = 64;
const OPACITY_MIN = 0.2;
const OPACITY_MAX = 1;

export function deskSettingsFromUnknown(value: unknown): DeskLyricsSettings {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const font = typeof record.fontSize === "number" && Number.isFinite(record.fontSize)
    ? Math.round(record.fontSize)
    : DEFAULT_DESK_LYRICS.fontSize;
  const opacity = typeof record.opacity === "number" && Number.isFinite(record.opacity)
    ? record.opacity
    : DEFAULT_DESK_LYRICS.opacity;
  const color = typeof record.color === "string" && /^#[0-9a-fA-F]{6}$/.test(record.color)
    ? record.color.toLowerCase()
    : DEFAULT_DESK_LYRICS.color;
  const x = typeof record.x === "number" && Number.isFinite(record.x) ? Math.round(record.x) : null;
  const y = typeof record.y === "number" && Number.isFinite(record.y) ? Math.round(record.y) : null;
  return {
    open: record.open === true,
    locked: record.locked === true,
    x: x == null || y == null ? null : x,
    y: x == null || y == null ? null : y,
    fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, font)),
    color,
    opacity: Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, opacity)),
  };
}

/**
 * Keep a saved point when it still meets a display. A missing screen, or no
 * saved point, lands on the first display's lower middle. Edges are not magnetic.
 */
export function clampDeskOrigin(
  point: { x: number; y: number } | null,
  areas: readonly DeskArea[],
  window: { width: number; height: number },
): { x: number; y: number } {
  const home = areas.find((area) => area.width > 0 && area.height > 0) ?? { x: 0, y: 0, width: 1280, height: 720 };
  const fallback = {
    x: Math.round(home.x + (home.width - window.width) / 2),
    y: Math.round(home.y + home.height - window.height - 72),
  };
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return fallback;
  const visible = areas.some((area) => (
    point.x < area.x + area.width - 48
    && point.x + window.width > area.x + 48
    && point.y < area.y + area.height - 32
    && point.y + window.height > area.y + 32
  ));
  return visible ? { x: Math.round(point.x), y: Math.round(point.y) } : fallback;
}

export function deskWindowSize(fontSize: number): { width: number; height: number } {
  const size = deskSettingsFromUnknown({ fontSize }).fontSize;
  return { width: 920, height: Math.round(size * 5.4) };
}
