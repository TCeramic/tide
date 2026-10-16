import type { AudioLevel } from "../core/audio-level";
import type { DeskLyricsSettings } from "../core/desk-lyrics";
import type { PlaybackEvents, PlaybackSnapshot, Track } from "../core/playback/types";
import { version as packageVersion } from "../../package.json";

export type { DeskLyricsSettings } from "../core/desk-lyrics";

export type { PlaybackErrorCode, PlaybackEvents, PlaybackSnapshot, PlaybackStatus, Track } from "../core/playback/types";

export const TIDE_VERSION = packageVersion;
export const DEFAULT_API_PORT = 39271;
export const DEFAULT_BUS_PORT = 39272;
export const API_READY_PREFIX = "TIDE_API_READY ";

export const Ipc = {
  replaceUpcoming: "tide:replace-upcoming",
  closeRequest: "tide:close-request",
  windowAction: "tide:window-action",
  renderActive: "tide:render-active",
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
  duration: "tide:cmd:duration",
  ended: "tide:cmd:ended",
  fail: "tide:cmd:fail",
  media: "tide:media",
  tideToday: "tide:today",
  appearance: "tide:appearance",
  appearanceSet: "tide:appearance:set",
  localList: "tide:local:list",
  localAdd: "tide:local:add",
  backdropPick: "tide:backdrop:pick",
  backdropUrl: "tide:backdrop:url",
  fontPick: "tide:font:pick",
  fontFace: "tide:font:face",
} as const;

/** Existing wash themes. `tide` is the default teal night; `dusk` is the warm night. */
export const THEMES = ["tide", "dusk"] as const;

export type ThemeId = (typeof THEMES)[number];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** Chrome language. Lens is the default glass shell. Lattice is an optional second look. */
export const SHELLS = ["lens", "lattice"] as const;
export type ShellId = (typeof SHELLS)[number];

export function isShellId(value: unknown): value is ShellId {
  return typeof value === "string" && (SHELLS as readonly string[]).includes(value);
}

/** Play-scene recipes. Names are Tide's. They are not a visual clone of another player. */
export const VISUAL_PRESETS = ["tide", "cover-glow", "vinyl", "stardust", "quiet"] as const;
export type VisualPresetId = (typeof VISUAL_PRESETS)[number];

export function isVisualPresetId(value: unknown): value is VisualPresetId {
  return typeof value === "string" && (VISUAL_PRESETS as readonly string[]).includes(value);
}

export const PERFORMANCE_TIERS = ["smooth", "balanced", "vivid"] as const;
export type PerformanceTier = (typeof PERFORMANCE_TIERS)[number];

export function isPerformanceTier(value: unknown): value is PerformanceTier {
  return typeof value === "string" && (PERFORMANCE_TIERS as readonly string[]).includes(value);
}

export const FONT_PRESETS = ["system", "song", "serif", "mono", "custom"] as const;
export type FontPresetId = (typeof FONT_PRESETS)[number];

export function isFontPresetId(value: unknown): value is FontPresetId {
  return typeof value === "string" && (FONT_PRESETS as readonly string[]).includes(value);
}

export const STAGE_BACKGROUNDS = ["solid", "cover", "image", "paper"] as const;
export type StageBackground = (typeof STAGE_BACKGROUNDS)[number];

export function isStageBackground(value: unknown): value is StageBackground {
  return typeof value === "string" && (STAGE_BACKGROUNDS as readonly string[]).includes(value);
}

/** Local UI knobs on #stage, #lyrics, and #chrome. No wallpaper engine and no particle clone. */
export interface Appearance {
  lensMode?: "light" | "dark";
  latticeMode?: "light" | "dark";
  chromeVisible: boolean;
  stageLevel: number;
  theme: ThemeId;
  /** 0 freezes the existing wash phase. 1 is the full phase travel. */
  motion: number;
  /** Optional playback lattice. Off until asked. Not the window shell. */
  lattice: boolean;
  /** Lens glass by default. Lattice restyles the title bar, dock, and progress. */
  shell: ShellId;
  /** Overall play-scene style. Details come after this choice. */
  preset: VisualPresetId;
  performance: PerformanceTier;
  /** Solid color, a cover-colored wash, or one local image. */
  background: StageBackground;
  /** Preset stack, or `custom` when fontFamily / an imported file is active. */
  fontPreset: FontPresetId;
  /** Manual family name. Empty uses the preset stack. */
  fontFamily: string;
}

export interface LyricWord {
  timeMs: number;
  durationMs: number;
  text: string;
}

export interface YrcLine {
  estimated?: boolean;
  timeMs: number;
  durationMs: number;
  text: string;
  words: LyricWord[];
}

export interface SearchHit {
  albumTitle?: string;
  albumId?: string;
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  playable: boolean;
  /** Present after a liked-id read. Omitted when the account's like list is unknown. */
  liked?: boolean;
  /** Album art URL. Omitted when the payload has none. */
  cover?: string;
}

export interface ArtistSummary {
  id: string;
  name: string;
  cover?: string;
}

export interface AlbumSummary {
  id: string;
  name: string;
  artist: string;
  cover?: string;
}

export type SearchKind = "songs" | "artists" | "albums";

export interface PlaylistCursor { playlistId: string; offset: number; hasMore: boolean }

export interface SearchResult {
  source?: PlaylistCursor;
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
  source?: "netease" | "amll";
  credits?: string[];
  ok: true;
  trackId: string;
  lines: LyricLine[];
  translation: LyricLine[];
  romaji: LyricLine[];
  /** Word lines from `/lyric/new`. Empty when the song has no yrc. */
  yrc: YrcLine[];
}

export interface DeskCue {
  title: string;
  /** Current line. The overlay does not parse YRC. */
  text: string;
  translation: string;
  /** 0–1 fill across the line. Word-level only when wordLevel is true. */
  progress: number;
  wordLevel: boolean;
  highlightFollow: boolean;
  playing: boolean;
  fontSize: number;
  color: string;
  highlightColor: string;
  fontFamily: string;
  opacity: number;
  glow: number;
  motion: boolean;
  pair: boolean;
  wave: boolean;
  farGlow: boolean;
  empty: boolean;
  orientation: "horizontal" | "vertical";
  /** 0.35–1. The overlay ignores this when motion is off. */
  motionLevel: number;
  /** 0 is a clear overlay. */
  backdrop: number;
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
  /** Account portrait. Omitted when the profile has no http(s) avatar. */
  avatar?: string;
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
  onCloseRequest?(listener: () => void): () => void;
  replaceUpcoming(hits: SearchHit[]): Promise<PlaybackSnapshot>;
  windowAction(action: "tray" | "quit" | "cancel"): Promise<void>;
  onRenderActive?(listener: (active: boolean) => void): () => void;
  aiStatus(): Promise<import("../core/ai-assist").AiStatus>;
  aiGenerate(input: import("../core/ai-assist").AiInput): Promise<import("../core/ai-assist").AiReply>;
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
  pushDeskLines(payload: { trackId: string; title: string; original: LyricLine[]; translation: LyricLine[]; yrc?: YrcLine[]; offsetMs: number }): void;
  pickFont(): Promise<{ family: string; dataUrl: string } | null>;
  fontFace(): Promise<{ family: string; dataUrl: string } | null>;
  onDeskCue(listener: (cue: DeskCue) => void): () => void;
  collectSong(playlistId: string, trackId: string): Promise<ApiFailure | { ok: true; message: string }>;
  playNext(hit: SearchHit): Promise<PlaybackSnapshot>;
  next(): Promise<PlaybackSnapshot>;
  previous(): Promise<PlaybackSnapshot>;
  setMode(patch: { repeat?: "off" | "all" | "one"; shuffle?: boolean; explore?: boolean }): Promise<PlaybackSnapshot>;
  onNotice(listener: (message: string) => void): () => void;
  playlistTracks(id: string, offset?: number): Promise<SearchResult | ApiFailure>;
  dailyRecommend(): Promise<SearchResult | ApiFailure>;
  radar(): Promise<SearchResult | ApiFailure>;
  tideToday(refresh?: boolean): Promise<TideToday | ApiFailure>;
  playHits(hits: SearchHit[], index: number, source?: PlaylistCursor): Promise<PlaybackSnapshot>;
  onMedia(listener: (cue: MediaCue) => void): () => void;
  reportProgress(positionMs: number): void;
  reportDuration(id: string, durationMs: number): void;
  ended(): Promise<PlaybackSnapshot>;
  failPlayback(code: "no_url" | "signed_out"): Promise<PlaybackSnapshot>;
  onAppearance(listener: (appearance: Appearance) => void): () => void;
  setAppearance(patch: Partial<Appearance>): Promise<Appearance>;
  localTracks(): Promise<SearchHit[]>;
  addLocalTracks(): Promise<SearchHit[]>;
  pickBackdrop(): Promise<string | null>;
  backdropUrl(): Promise<string | null>;
}
