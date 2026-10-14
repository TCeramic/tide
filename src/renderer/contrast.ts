/** WCAG relative luminance and contrast. Used to lock lyric colors against the brightest wash. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function composite(over: Rgb & { a: number }, under: Rgb): Rgb {
  const a = Math.min(1, Math.max(0, over.a));
  return {
    r: over.r * a + under.r * (1 - a),
    g: over.g * a + under.g * (1 - a),
    b: over.b * a + under.b * (1 - a),
  };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const l1 = 0.2126 * channel(fg.r) + 0.7152 * channel(fg.g) + 0.0722 * channel(fg.b);
  const l2 = 0.2126 * channel(bg.r) + 0.7152 * channel(bg.g) + 0.0722 * channel(bg.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Brightest shader pixel: full mix to the theme blob plus the sheen term in lens-field.ts.
 * tideA (0.11, 0.52, 0.51) + 0.09 * (0.75, 0.92, 0.95)
 * duskA (0.70, 0.40, 0.26) + 0.09 * (1, 0.86, 0.72)
 */
export const LENS_PEAK = {
  tide: { r: 0.1775 * 255, g: 0.6028 * 255, b: 0.5955 * 255 },
  dusk: { r: 0.79 * 255, g: 0.4774 * 255, b: 0.3248 * 255 },
} as const;

/** Lattice dot fills painted in stage.ts. */
export const LATTICE_DOT = {
  tide: { r: 214, g: 248, b: 244, a: 0.9 },
  dusk: { r: 255, g: 220, b: 186, a: 0.88 },
} as const;
