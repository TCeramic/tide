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
  highlightColor: string;
  fontFamily: string;
  opacity: number;
  /** Word sweep inside the glyph. Off keeps one even line. */
  highlightFollow: boolean;
  /** Line-enter fade. Off holds the new line still. */
  motion: boolean;
  /** 0 hides the colored glow. 1 is the full halo. */
  glow: number;
  /** Second line for a translation. The default is one line. */
  pair: boolean;
  lineMode: "single" | "double";
  toggleShortcut: string;
  /** Optional wave drawn behind the line, never through the glyphs. */
  wave: boolean;
  /** Horizontal line, or the same line set as a vertical column. */
  orientation: "horizontal" | "vertical";
  /** Scales the line-enter travel. The motion switch still turns the enter off. */
  motionLevel: number;
  /** 0 leaves the overlay clear. Higher values wash a soft plate behind the line. */
  backdrop: number;
}

export const DESK_TOGGLE_ACCELERATOR = "CommandOrControl+Alt+D";

export const DEFAULT_DESK_LYRICS: DeskLyricsSettings = {
  open: false,
  locked: false,
  x: null,
  y: null,
  fontSize: 48,
  color: "#f7fbfc",
  highlightColor: "#fff0b8",
  fontFamily: "Microsoft YaHei",
  opacity: 1,
  highlightFollow: true,
  motion: true,
  glow: 0.72,
  pair: false,
  lineMode: "single",
  toggleShortcut: "Ctrl+Alt+D",
  wave: false,
  orientation: "horizontal",
  motionLevel: 1,
  backdrop: 0,
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
  const glow = typeof record.glow === "number" && Number.isFinite(record.glow) ? record.glow : DEFAULT_DESK_LYRICS.glow;
  const motionLevel = typeof record.motionLevel === "number" && Number.isFinite(record.motionLevel)
    ? record.motionLevel
    : DEFAULT_DESK_LYRICS.motionLevel;
  const backdrop = typeof record.backdrop === "number" && Number.isFinite(record.backdrop)
    ? record.backdrop
    : DEFAULT_DESK_LYRICS.backdrop;
  return {
    open: record.open === true,
    locked: record.locked === true,
    x: x == null || y == null ? null : x,
    y: x == null || y == null ? null : y,
    fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, font)),
    color,
    highlightColor: typeof record.highlightColor === "string" && /^#[0-9a-fA-F]{6}$/.test(record.highlightColor) ? record.highlightColor.toLowerCase() : DEFAULT_DESK_LYRICS.highlightColor,
    fontFamily: typeof record.fontFamily === "string" && record.fontFamily.trim() ? record.fontFamily.replace(/[\x00-\x1f";{}]/g, "").trim().slice(0,80) || DEFAULT_DESK_LYRICS.fontFamily : DEFAULT_DESK_LYRICS.fontFamily,
    opacity: Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, opacity)),
    highlightFollow: record.highlightFollow !== false,
    motion: record.motion !== false,
    glow: Math.min(1, Math.max(0, glow)),
    pair: record.pair === true,
    lineMode: record.lineMode === "double" ? "double" : "single",
    toggleShortcut: typeof record.toggleShortcut === "string" && (record.toggleShortcut === "" || /^(?:(?:Ctrl|Control|Alt|Shift|Meta|CommandOrControl)\+){1,3}(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space)$/.test(record.toggleShortcut)) ? record.toggleShortcut : DEFAULT_DESK_LYRICS.toggleShortcut,
    wave: record.wave === true,
    orientation: record.orientation === "vertical" ? "vertical" : "horizontal",
    motionLevel: Math.min(1, Math.max(0.35, motionLevel)),
    backdrop: Math.min(0.55, Math.max(0, backdrop)),
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

export function deskWindowSize(
  fontSize: number,
  pair = false,
  orientation: "horizontal" | "vertical" = "horizontal",
  double = false,
): { width: number; height: number } {
  const size = deskSettingsFromUnknown({ fontSize }).fontSize;
  if (orientation === "vertical") {
    return { width: Math.round(size * (2.4 + (pair ? 1.2 : 0) + (double ? 1.3 : 0)) + 36), height: 640 };
  }
  const lines = 2.15 + (pair ? 1.25 : 0) + (double ? 1.3 : 0);
  return { width: 1080, height: Math.round(size * lines + 28) };
}

/** Keep the visual center during orientation changes and fit the whole window on its display. */
export function fitDeskBounds(anchor: {x:number;y:number}, size:{width:number;height:number}, areas:readonly DeskArea[]): DeskArea {
 const area=areas.find(a=>anchor.x>=a.x&&anchor.x<=a.x+a.width&&anchor.y>=a.y&&anchor.y<=a.y+a.height)??areas[0]??{x:0,y:0,width:1920,height:1080};
 const width=Math.min(size.width,area.width),height=Math.min(size.height,area.height);
 return {width,height,x:Math.round(Math.max(area.x,Math.min(area.x+area.width-width,anchor.x-width/2))),y:Math.round(Math.max(area.y,Math.min(area.y+area.height-height,anchor.y-height/2)))};
}
