export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";

export type PlaybackErrorCode = "empty_queue" | "track_missing" | "no_url" | "signed_out";

export interface Track {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
}

export interface PlaybackSnapshot {
  status: PlaybackStatus;
  queue: Track[];
  index: number;
  positionMs: number;
  volume: number;
  error: PlaybackErrorCode | null;
}

/** Domain events the kernel publishes. Names match the M1 contract. */
export interface PlaybackEvents {
  play: { snapshot: PlaybackSnapshot };
  pause: { snapshot: PlaybackSnapshot };
  seek: { positionMs: number; snapshot: PlaybackSnapshot };
  volume: { volume: number; snapshot: PlaybackSnapshot };
  queue: { snapshot: PlaybackSnapshot };
  "track-change": { index: number; snapshot: PlaybackSnapshot };
}
