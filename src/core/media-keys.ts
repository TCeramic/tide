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

export type MediaKeyMode = "session" | "shortcut";

/**
 * Windows delivers one hardware key to both `globalShortcut` and `mediaSession`.
 * One path only, so play/pause is not toggled twice.
 */
export function mediaKeyMode(platform: string): MediaKeyMode {
  return platform === "win32" ? "session" : "shortcut";
}

export function dispatchMediaKey(
  platform: string,
  action: MediaAction,
  handlers: { shortcut: (action: MediaAction) => void; session: (action: MediaAction) => void },
): void {
  if (mediaKeyMode(platform) === "session") handlers.session(action);
  else handlers.shortcut(action);
}
