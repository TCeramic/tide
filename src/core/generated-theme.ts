export interface GeneratedTheme { name: string; colors: string[]; accent: string; source: "cover" | "local" | "model"; }
const hex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");

/** Local cover quantization, independent of Folia's AGPL implementation. No model call. */
export function themeFromPixels(pixels: ArrayLike<number>, seed: string): GeneratedTheme {
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
    if (pixels[i + 3]! < 128 || Math.max(r, g, b) < 20 || Math.min(r, g, b) > 235) continue;
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bin.count++; bin.r += r; bin.g += g; bin.b += b; bins.set(key, bin);
  }
  const palette = [...bins.values()].sort((a, b) => b.count - a.count).slice(0, 4).map(bin => `#${hex(bin.r / bin.count)}${hex(bin.g / bin.count)}${hex(bin.b / bin.count)}`);
  if (!palette.length) {
    let hash = 2166136261; for (const char of seed) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
    const color = (shift: number) => `#${hex(72 + (hash >>> shift & 127))}${hex(72 + (hash >>> (shift + 6) & 127))}${hex(72 + (hash >>> (shift + 12) & 127))}`;
    palette.push(color(0), color(5), color(10));
  }
  const accent = palette[0]!;
  return { name: bins.size ? "封面配色" : "本地配色", colors: ["#101a27", ...palette, "#23394b"], accent, source: bins.size ? "cover" : "local" };
}

export function validateGeneratedTheme(value: unknown): GeneratedTheme {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (!Array.isArray(row.colors) || row.colors.length < 2 || row.colors.length > 8 || !row.colors.every(color => typeof color === "string" && /^#[\da-f]{6}$/i.test(color))) throw new Error("配色需包含 2–8 个 #RRGGBB 颜色");
  if (typeof row.accent !== "string" || !/^#[\da-f]{6}$/i.test(row.accent)) throw new Error("强调色格式无效");
  return { name: typeof row.name === "string" ? row.name.slice(0, 40) : "模型配色", colors: row.colors as string[], accent: row.accent, source: "model" };
}
