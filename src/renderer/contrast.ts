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
