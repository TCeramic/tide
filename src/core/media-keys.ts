/** OS media keys. The main process registers these; the window mirrors them on mediaSession. */
export const MEDIA_SHORTCUTS = ["MediaPlayPause", "MediaNextTrack", "MediaPreviousTrack"] as const;

export type MediaShortcut = (typeof MEDIA_SHORTCUTS)[number];

export type MediaAction = "toggle" | "next" | "previous";

export const MEDIA_SESSION_ACTIONS = ["play", "pause", "nexttrack", "previoustrack"] as const;

export type MediaSessionAction = (typeof MEDIA_SESSION_ACTIONS)[number];

export function shortcutAction(accelerator: string): MediaAction | null {
  if (accelerator === "MediaPlayPause") return "toggle";
  if (accelerator === "MediaNextTrack") return "next";
  if (accelerator === "MediaPreviousTrack") return "previous";
  return null;
}
