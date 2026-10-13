import type { PlaybackEvents, PlaybackSnapshot, Track } from "../core/playback/types";

export type { PlaybackErrorCode, PlaybackEvents, PlaybackSnapshot, PlaybackStatus, Track } from "../core/playback/types";

export const TIDE_VERSION = "0.1.0";
export const DEFAULT_API_PORT = 39271;
export const API_READY_PREFIX = "TIDE_API_READY ";

export const Ipc = {
  healthGet: "tide:health:get",
  health: "tide:health",
  playbackGet: "tide:playback:get",
  playback: "tide:playback",
  bus: "tide:bus",
  play: "tide:cmd:play",
  pause: "tide:cmd:pause",
  seek: "tide:cmd:seek",
  volume: "tide:cmd:volume",
  queue: "tide:cmd:queue",
  track: "tide:cmd:track",
} as const;

export interface HealthStatus {
  ok: boolean;
  service?: string;
  port?: number;
  error: string | null;
}

export type PlaybackBusEvent = {
  [K in keyof PlaybackEvents]: { type: K } & PlaybackEvents[K];
}[keyof PlaybackEvents];

export interface QueueRequest {
  queue: Track[];
  index?: number;
}

/** Surface exposed on `window.tide` by the preload script. */
export interface TideBridge {
  getHealth(): Promise<HealthStatus>;
  onHealth(listener: (status: HealthStatus) => void): () => void;
  getPlayback(): Promise<PlaybackSnapshot>;
  onPlayback(listener: (snapshot: PlaybackSnapshot) => void): () => void;
  onEvent(listener: (event: PlaybackBusEvent) => void): () => void;
  play(): Promise<PlaybackSnapshot>;
  pause(): Promise<PlaybackSnapshot>;
  seek(positionMs: number): Promise<PlaybackSnapshot>;
  setVolume(volume: number): Promise<PlaybackSnapshot>;
  setQueue(queue: Track[], index?: number): Promise<PlaybackSnapshot>;
  changeTrack(index: number): Promise<PlaybackSnapshot>;
}
