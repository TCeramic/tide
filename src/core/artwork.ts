/** Normalize the CDN transport before it reaches Electron's HTTPS-only image policy. */
export function normalizeArtworkUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const raw = value.trim();
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    if (url.protocol === "http:" && (url.hostname === "126.net" || url.hostname.endsWith(".126.net"))) url.protocol = "https:";
    return url.href;
  } catch { return null; }
}
