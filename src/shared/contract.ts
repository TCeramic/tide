import type { PlaybackEvents, PlaybackSnapshot, Track } from "../core/playback/types";

export type { PlaybackErrorCode, PlaybackEvents, PlaybackSnapshot, PlaybackStatus, Track } from "../core/playback/types";

export const TIDE_VERSION = "0.7.0";
export const DEFAULT_API_PORT = 39271;
export const DEFAULT_BUS_PORT = 39272;
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
  sessionGet: "tide:session:get",
  sessionCookie: "tide:session:cookie",
  sessionLogout: "tide:session:logout",
  sessionQrStart: "tide:session:qr:start",
  sessionQrCheck: "tide:session:qr:check",
  search: "tide:search",
  playlistTracks: "tide:playlist:tracks",
  daily: "tide:recommend:daily",
  radar: "tide:recommend:radar",
  playHits: "tide:cmd:play-hits",
  progress: "tide:cmd:progress",
  ended: "tide:cmd:ended",
  fail: "tide:cmd:fail",
  media: "tide:media",
  tideToday: "tide:today",
  appearance: "tide:appearance",
} as const;

/** Existing wash themes. `tide` is the default teal night; `dusk` is the warm night. */
export const THEMES = ["tide", "dusk"] as const;

export type ThemeId = (typeof THEMES)[number];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** Local UI knobs on #stage, #lyrics, and #chrome. No wallpaper and no particle system. */
export interface Appearance {
  chromeVisible: boolean;
  stageLevel: number;
  theme: ThemeId;
  /** 0 freezes the existing wash phase. 1 is the full phase travel. */
  motion: number;
}

export interface SearchHit {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  playable: boolean;
}

export interface SearchResult {
  ok: true;
  hits: SearchHit[];
}

/** First-party daily list. Built from the local listen log, not NetEase recommend APIs. */
export interface TideToday {
  ok: true;
  hits: SearchHit[];
  message: string | null;
}

export interface MediaCue {
  trackId: string;
  url: string | null;
}

export type SessionState = "signed_out" | "logged_in" | "invalid";

export interface SessionUser {
  id: string;
  nickname: string;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  trackCount: number;
  /** NetEase playlist kind. 5 is the personal liked-songs list. */
  specialType?: number;
}

export interface SessionSnapshot {
  ok: true;
  state: SessionState;
  message: string | null;
  user: SessionUser | null;
  playlists: PlaylistSummary[];
}

export interface QrTicket {
  ok: true;
  key: string;
  qrimg: string;
  qrurl: string;
}

export interface QrCheck {
  ok: true;
  code: number;
  message: string;
  session: SessionSnapshot | null;
}

export interface ApiFailure {
  ok: false;
  error: string;
  message: string;
}

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
  getSession(): Promise<SessionSnapshot | ApiFailure>;
  saveCookie(cookie: string): Promise<SessionSnapshot | ApiFailure>;
  logout(): Promise<SessionSnapshot | ApiFailure>;
  startQr(): Promise<QrTicket | ApiFailure>;
  checkQr(key: string): Promise<QrCheck | ApiFailure>;
  search(keywords: string): Promise<SearchResult | ApiFailure>;
  playlistTracks(id: string): Promise<SearchResult | ApiFailure>;
  dailyRecommend(): Promise<SearchResult | ApiFailure>;
  radar(): Promise<SearchResult | ApiFailure>;
  tideToday(): Promise<TideToday | ApiFailure>;
  playHits(hits: SearchHit[], index: number): Promise<PlaybackSnapshot>;
  onMedia(listener: (cue: MediaCue) => void): () => void;
  reportProgress(positionMs: number): void;
  ended(): Promise<PlaybackSnapshot>;
  failPlayback(code: "no_url" | "signed_out"): Promise<PlaybackSnapshot>;
  onAppearance(listener: (appearance: Appearance) => void): () => void;
}
