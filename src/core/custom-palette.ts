import type { CustomPalette } from "../shared/contract";

const hex = (value: unknown): value is string => typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
export function customPaletteFromUnknown(value: unknown): CustomPalette | undefined {
  if (!value || typeof value !== "object") return;
  const p = value as Record<string, unknown>;
  if (!Array.isArray(p.colors) || p.colors.length < 2 || p.colors.length > 8 || !p.colors.every(hex)) return;
  if (![p.accent, p.text, p.muted, p.points, p.panel].every(hex)) return;
  if (typeof p.panelOpacity !== "number" || !Number.isFinite(p.panelOpacity)) return;
  return { enabled: p.enabled === true, colors: p.colors.map(c => c.toLowerCase()),
    accent: p.accent as string, text: p.text as string, muted: p.muted as string,
    points: p.points as string, panel: p.panel as string, panelOpacity: Math.max(.08, Math.min(.92, p.panelOpacity)) };
}
