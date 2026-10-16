export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";

export type RepeatMode = "off" | "all" | "one";

export type PlaybackErrorCode = "empty_queue" | "track_missing" | "no_url" | "signed_out";

export interface Track {
  albumTitle?: string;
  albumId?: string;
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  /** Album art. Omitted when the row has no picture. */
  cover?: string;
}

export interface PlaybackSnapshot {
  status: PlaybackStatus;
  queue: Track[];
  index: number;
  positionMs: number;
  volume: number;
  error: PlaybackErrorCode | null;
  repeat: RepeatMode;
  shuffle: boolean;
  explore: boolean;
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
