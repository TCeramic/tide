/** Levels accepted by NeteaseCloudMusicApi `song_url_v1`. Higher entries fall back toward standard. */
export const AUDIO_LEVELS = ["standard", "exhigh", "lossless", "hires"] as const;

export type AudioLevel = (typeof AUDIO_LEVELS)[number];

export const AUDIO_LEVEL_LABEL: Record<AudioLevel, string> = {
  standard: "标准",
  exhigh: "极高",
  lossless: "无损",
  hires: "Hi-Res",
};

export function isAudioLevel(value: unknown): value is AudioLevel {
  return typeof value === "string" && (AUDIO_LEVELS as readonly string[]).includes(value);
}

/** Requested level first, then each lower step, ending at standard. */
export function fallbackLevels(level: AudioLevel): AudioLevel[] {
  const index = AUDIO_LEVELS.indexOf(level);
  return AUDIO_LEVELS.slice(0, index + 1).reverse();
}

export async function resolveSongLevel(
  requested: AudioLevel,
  load: (level: AudioLevel) => Promise<{ url: string | null; signedOut: boolean }>,
): Promise<{ url: string | null; signedOut: boolean; level: AudioLevel; requested: AudioLevel }> {
  for (const level of fallbackLevels(requested)) {
    const media = await load(level);
    if (media.signedOut) return { url: null, signedOut: true, level, requested };
    if (media.url) return { url: media.url, signedOut: false, level, requested };
  }
  return { url: null, signedOut: false, level: "standard", requested };
}
