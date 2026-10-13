import { MEDIA_SESSION_ACTIONS } from "../core/media-keys";
import type { PlaybackSnapshot } from "../shared/contract";

/** Windows SMTC reads this session. Action handlers run only on Windows, so they do not double-fire with globalShortcut. */
export function installMediaSession(): void {
  const session = navigator.mediaSession;
  if (!session || window.tide.mediaKeys !== "session") return;
  const run: Record<(typeof MEDIA_SESSION_ACTIONS)[number], () => void> = {
    play: () => void window.tide.hardwareKey("play"),
    pause: () => void window.tide.hardwareKey("pause"),
    nexttrack: () => void window.tide.hardwareKey("next"),
    previoustrack: () => void window.tide.hardwareKey("previous"),
    stop: () => void window.tide.hardwareKey("stop"),
  };
  for (const action of MEDIA_SESSION_ACTIONS) {
    try {
      session.setActionHandler(action, () => run[action]());
    } catch {
      // The platform may reject a handler. The in-window controls still work.
    }
  }
}

export function syncMediaSession(snapshot: PlaybackSnapshot): void {
  const session = navigator.mediaSession;
  if (!session) return;
  const track = snapshot.index >= 0 ? snapshot.queue[snapshot.index] : undefined;
  if (track && typeof MediaMetadata === "function") {
    session.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: "潮汐",
    });
  }
  session.playbackState = snapshot.status === "playing" ? "playing" : "paused";
}
