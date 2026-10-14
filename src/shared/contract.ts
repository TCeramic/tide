import type { AudioLevel } from "../core/audio-level";
import type { DeskLyricsSettings } from "../core/desk-lyrics";
import type { PlaybackEvents, PlaybackSnapshot, Track } from "../core/playback/types";

export type { DeskLyricsSettings } from "../core/desk-lyrics";

export type { PlaybackErrorCode, PlaybackEvents, PlaybackSnapshot, PlaybackStatus, Track } from "../core/playback/types";

export const TIDE_VERSION = "0.9.0";
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
  artistSongs: "tide:artist:songs",
  albumTracks: "tide:album:tracks",
  lyric: "tide:lyric",
  likeSong: "tide:song:like",
  collectSong: "tide:song:collect",
  playNext: "tide:cmd:play-next",
  next: "tide:cmd:next",
  previous: "tide:cmd:previous",
  mode: "tide:cmd:mode",
  notice: "tide:notice",
  queueRemove: "tide:cmd:queue-remove",
  queueMove: "tide:cmd:queue-move",
  queueClear: "tide:cmd:queue-clear",
  personalFm: "tide:fm",
  fmTrash: "tide:fm:trash",
  qualityGet: "tide:quality:get",
  qualitySet: "tide:quality:set",
  mediaShortcutsGet: "tide:keys:get",
  mediaShortcutsSet: "tide:keys:set",
  captureMediaKeysSet: "tide:keys:capture",
  hardwareKey: "tide:keys:hardware",
  likedIds: "tide:liked:ids",
  deskGet: "tide:desk:get",
  deskSet: "tide:desk:set",
  deskState: "tide:desk:state",
  deskLines: "tide:desk:lines",
  deskCue: "tide:desk:cue",
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
  /** Present after a liked-id read. Omitted when the account's like list is unknown. */
  liked?: boolean;
}

export interface ArtistSummary {
  id: string;
  name: string;
}

export interface AlbumSummary {
  id: string;
  name: string;
  artist: string;
}

export type SearchKind = "songs" | "artists" | "albums";

export interface SearchResult {
  ok: true;
  kind: SearchKind;
  hits: SearchHit[];
  artists: ArtistSummary[];
  albums: AlbumSummary[];
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface LyricPayload {
  ok: true;
  trackId: string;
  lines: LyricLine[];
  translation: LyricLine[];
  romaji: LyricLine[];
}

export interface DeskCue {
  title: string;
  previous: string;
  current: string;
  translation: string;
  next: string;
  empty: boolean;
  fontSize: number;
  color: string;
  opacity: number;
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
  /** Command-bus port. Present on the window health event, not on the API /health JSON. */
  busPort?: number;
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
  /** `session` on Windows, `shortcut` elsewhere. Only one media-key path is armed. */
  mediaKeys: "session" | "shortcut";
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
  search(keywords: string, type?: number): Promise<SearchResult | ApiFailure>;
  artistSongs(id: string): Promise<SearchResult | ApiFailure>;
  albumTracks(id: string): Promise<SearchResult | ApiFailure>;
  lyric(id: string): Promise<LyricPayload | ApiFailure>;
  queueRemove(index: number): Promise<PlaybackSnapshot>;
  queueMove(from: number, to: number): Promise<PlaybackSnapshot>;
  queueClear(): Promise<PlaybackSnapshot>;
  personalFm(): Promise<SearchResult | ApiFailure>;
  fmTrash(id: string): Promise<ApiFailure | { ok: true; message: string }>;
  getQuality(): Promise<AudioLevel>;
  setQuality(level: AudioLevel): Promise<AudioLevel>;
  getMediaShortcuts(): Promise<{ shortcuts: { toggle: string; next: string; previous: string; stop: string }; messages: string[]; captureMediaKeys: boolean }>;
  setMediaShortcuts(shortcuts: { toggle: string; next: string; previous: string; stop: string }): Promise<{ shortcuts: { toggle: string; next: string; previous: string; stop: string }; messages: string[] }>;
  setCaptureMediaKeys(capture: boolean): Promise<{ captureMediaKeys: boolean }>;
  hardwareKey(action: "play" | "pause" | "next" | "previous" | "stop"): Promise<PlaybackSnapshot>;
  likeSong(id: string, like: boolean): Promise<ApiFailure | { ok: true; message: string; liked: boolean }>;
  likedIds(): Promise<ApiFailure | { ok: true; known: boolean; ids: string[] }>;
  getDeskLyrics(): Promise<DeskLyricsSettings>;
  setDeskLyrics(patch: Partial<DeskLyricsSettings>): Promise<DeskLyricsSettings>;
  onDeskState(listener: (settings: DeskLyricsSettings) => void): () => void;
  pushDeskLines(payload: { trackId: string; title: string; original: LyricLine[]; translation: LyricLine[]; offsetMs: number }): void;
  onDeskCue(listener: (cue: DeskCue) => void): () => void;
  collectSong(playlistId: string, trackId: string): Promise<ApiFailure | { ok: true; message: string }>;
  playNext(hit: SearchHit): Promise<PlaybackSnapshot>;
  next(): Promise<PlaybackSnapshot>;
  previous(): Promise<PlaybackSnapshot>;
  setMode(patch: { repeat?: "off" | "all" | "one"; shuffle?: boolean; explore?: boolean }): Promise<PlaybackSnapshot>;
  onNotice(listener: (message: string) => void): () => void;
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
