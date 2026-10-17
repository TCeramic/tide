import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AudioLevel } from "../core/audio-level";
import type { DeskLyricsSettings } from "../core/desk-lyrics";
import { mediaKeyMode, type MediaShortcutMap } from "../core/media-keys";
import { Ipc, type ApiFailure, type Appearance, type DeskCue, type HealthStatus, type LyricLine, type LyricPayload, type MediaCue, type PlaybackBusEvent, type PlaybackSnapshot, type QrCheck, type QrTicket, type QueueRequest, type SearchHit, type SearchResult, type SessionSnapshot, type TideBridge, type TideToday, type Track, type YrcLine } from "../shared/contract";

function listen<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const tide: TideBridge = {
  setFullscreen:value=>ipcRenderer.invoke("tide:fullscreen",value),
  captureThemeFrame:()=>ipcRenderer.invoke("tide:theme-frame"),
  onFullscreen:listener=>listen<boolean>("tide:fullscreen-state",listener),
  onLikeState: listener => listen<{id:string;liked:boolean}>("tide:like-state",listener),
  getMiniPlayer:()=>ipcRenderer.invoke("tide:mini-get"),
  setMiniPlayer:patch=>ipcRenderer.invoke("tide:mini-set",patch),
  miniShowMain:()=>ipcRenderer.invoke("tide:mini-main"),
  setMiniInteractive:interactive=>ipcRenderer.invoke("tide:mini-interactive",interactive),
  setDeskInteractive:interactive=>ipcRenderer.invoke("tide:desk-interactive",interactive),
  onMiniCue:listener=>listen("tide:mini-cue",listener),
  centerDeskLyrics:()=>ipcRenderer.invoke(Ipc.deskCenter),
  tidePlaylists:()=>ipcRenderer.invoke("tide:lists"),
  saveTidePlaylist:(id,patch)=>ipcRenderer.invoke("tide:list-save",id,patch),
  addToTidePlaylist:(id,hit)=>ipcRenderer.invoke("tide:list-add",id,hit),
  removeTidePlaylistSong:(id,songId)=>ipcRenderer.invoke("tide:list-remove-song",id,songId),
  deleteTidePlaylist:id=>ipcRenderer.invoke("tide:list-delete",id),
  pickPlaylistCover:()=>ipcRenderer.invoke("tide:list-cover"),
  syncTidePlaylist:id=>ipcRenderer.invoke("tide:list-sync",id),
  aiStatus: () => ipcRenderer.invoke("tide:ai-status"),
  aiGenerate: (input) => ipcRenderer.invoke("tide:ai-generate", input),
  mediaKeys: mediaKeyMode(process.platform),
  getHealth: () => ipcRenderer.invoke(Ipc.healthGet) as Promise<HealthStatus>,
  onHealth: (listener) => listen<HealthStatus>(Ipc.health, listener),
  getPlayback: () => ipcRenderer.invoke(Ipc.playbackGet) as Promise<PlaybackSnapshot>,
  onPlayback: (listener) => listen<PlaybackSnapshot>(Ipc.playback, listener),
  onEvent: (listener) => listen<PlaybackBusEvent>(Ipc.bus, listener),
  play: () => ipcRenderer.invoke(Ipc.play) as Promise<PlaybackSnapshot>,
  pause: () => ipcRenderer.invoke(Ipc.pause) as Promise<PlaybackSnapshot>,
  seek: (positionMs) => ipcRenderer.invoke(Ipc.seek, positionMs) as Promise<PlaybackSnapshot>,
  setVolume: (volume) => ipcRenderer.invoke(Ipc.volume, volume) as Promise<PlaybackSnapshot>,
  setQueue: (queue: Track[], index?: number) => {
    const request: QueueRequest = { queue, index };
    return ipcRenderer.invoke(Ipc.queue, request) as Promise<PlaybackSnapshot>;
  },
  changeTrack: (index) => ipcRenderer.invoke(Ipc.track, index) as Promise<PlaybackSnapshot>,
  getSession: () => ipcRenderer.invoke(Ipc.sessionGet) as Promise<SessionSnapshot | ApiFailure>,
  saveCookie: (cookie) => ipcRenderer.invoke(Ipc.sessionCookie, cookie) as Promise<SessionSnapshot | ApiFailure>,
  logout: () => ipcRenderer.invoke(Ipc.sessionLogout) as Promise<SessionSnapshot | ApiFailure>,
  startQr: () => ipcRenderer.invoke(Ipc.sessionQrStart) as Promise<QrTicket | ApiFailure>,
  checkQr: (key) => ipcRenderer.invoke(Ipc.sessionQrCheck, key) as Promise<QrCheck | ApiFailure>,
  search: (keywords, type, offset) => ipcRenderer.invoke(Ipc.search, keywords, type ?? 1, offset ?? 0) as Promise<SearchResult | ApiFailure>,
  artistSongs: (id) => ipcRenderer.invoke(Ipc.artistSongs, id) as Promise<SearchResult | ApiFailure>,
  albumTracks: (id) => ipcRenderer.invoke(Ipc.albumTracks, id) as Promise<SearchResult | ApiFailure>,
  lyric: (id) => ipcRenderer.invoke(Ipc.lyric, id) as Promise<LyricPayload | ApiFailure>,
  queueRemove: (index) => ipcRenderer.invoke(Ipc.queueRemove, index) as Promise<PlaybackSnapshot>,
  queueMove: (from, to) => ipcRenderer.invoke(Ipc.queueMove, from, to) as Promise<PlaybackSnapshot>,
  queueClear: () => ipcRenderer.invoke(Ipc.queueClear) as Promise<PlaybackSnapshot>,
  personalFm: () => ipcRenderer.invoke(Ipc.personalFm) as Promise<SearchResult | ApiFailure>,
  fmTrash: (id) => ipcRenderer.invoke(Ipc.fmTrash, id) as Promise<ApiFailure | { ok: true; message: string }>,
  getQuality: () => ipcRenderer.invoke(Ipc.qualityGet) as Promise<AudioLevel>,
  setQuality: (level) => ipcRenderer.invoke(Ipc.qualitySet, level) as Promise<AudioLevel>,
  getMediaShortcuts: () => ipcRenderer.invoke(Ipc.mediaShortcutsGet) as Promise<{ shortcuts: MediaShortcutMap; messages: string[]; captureMediaKeys: boolean }>,
  setMediaShortcuts: (shortcuts) => ipcRenderer.invoke(Ipc.mediaShortcutsSet, shortcuts) as Promise<{ shortcuts: MediaShortcutMap; messages: string[] }>,
  setCaptureMediaKeys: (capture) => ipcRenderer.invoke(Ipc.captureMediaKeysSet, capture) as Promise<{ captureMediaKeys: boolean }>,
  hardwareKey: (action) => ipcRenderer.invoke(Ipc.hardwareKey, action) as Promise<PlaybackSnapshot>,
  likeSong: (id, like) => ipcRenderer.invoke(Ipc.likeSong, id, like) as Promise<ApiFailure | { ok: true; message: string; liked: boolean }>,
  likedIds: () => ipcRenderer.invoke(Ipc.likedIds) as Promise<ApiFailure | { ok: true; known: boolean; ids: string[] }>,
  openDeskMenu: () => ipcRenderer.invoke(Ipc.deskContext),
  closeDeskMenu: () => ipcRenderer.invoke(Ipc.deskContextClose),
  getDeskLyrics: () => ipcRenderer.invoke(Ipc.deskGet) as Promise<DeskLyricsSettings>,
  setDeskLyrics: (patch) => ipcRenderer.invoke(Ipc.deskSet, patch) as Promise<DeskLyricsSettings>,
  onDeskState: (listener) => listen<DeskLyricsSettings>(Ipc.deskState, listener),
  pushDeskLines: (payload: { trackId: string; title: string; original: LyricLine[]; translation: LyricLine[]; yrc?: YrcLine[]; offsetMs: number }) => {
    ipcRenderer.send(Ipc.deskLines, payload);
  },
  onDeskCue: (listener) => listen<DeskCue>(Ipc.deskCue, listener),
  collectSong: (playlistId, trackId) => ipcRenderer.invoke(Ipc.collectSong, playlistId, trackId) as Promise<ApiFailure | { ok: true; message: string }>,
  playNext: (hit: SearchHit) => ipcRenderer.invoke(Ipc.playNext, hit) as Promise<PlaybackSnapshot>,
  next: () => ipcRenderer.invoke(Ipc.next) as Promise<PlaybackSnapshot>,
  previous: () => ipcRenderer.invoke(Ipc.previous) as Promise<PlaybackSnapshot>,
  setMode: (patch) => ipcRenderer.invoke(Ipc.mode, patch) as Promise<PlaybackSnapshot>,
  onNotice: (listener) => listen<string>(Ipc.notice, listener),
  playlistTracks: (id, offset) => ipcRenderer.invoke(Ipc.playlistTracks, id, offset) as Promise<SearchResult | ApiFailure>,
  dailyRecommend: () => ipcRenderer.invoke(Ipc.daily) as Promise<SearchResult | ApiFailure>,
  radar: () => ipcRenderer.invoke(Ipc.radar) as Promise<SearchResult | ApiFailure>,
  tideToday: (refresh) => ipcRenderer.invoke(Ipc.tideToday, refresh) as Promise<TideToday | ApiFailure>,
  playHits: (hits, index, source) => ipcRenderer.invoke(Ipc.playHits, hits, index, source) as Promise<PlaybackSnapshot>,
  onMedia: (listener) => listen<MediaCue>(Ipc.media, listener),
  reportProgress: (positionMs) => {
    ipcRenderer.send(Ipc.progress, positionMs);
  },
  reportDuration: (id, durationMs) => ipcRenderer.send(Ipc.duration, id, durationMs),
  ended: () => ipcRenderer.invoke(Ipc.ended) as Promise<PlaybackSnapshot>,
  failPlayback: (code) => ipcRenderer.invoke(Ipc.fail, code) as Promise<PlaybackSnapshot>,
  replaceUpcoming: (hits) => ipcRenderer.invoke(Ipc.replaceUpcoming, hits) as Promise<PlaybackSnapshot>,
  onCloseRequest: (listener) => listen<void>(Ipc.closeRequest, listener),
  windowAction: (action) => ipcRenderer.invoke(Ipc.windowAction, action) as Promise<void>,
  onRenderActive: (listener) => listen<boolean>(Ipc.renderActive, listener),
  onAppearance: (listener) => listen<Appearance>(Ipc.appearance, listener),
  setAppearance: (patch) => ipcRenderer.invoke(Ipc.appearanceSet, patch) as Promise<Appearance>,
  localTracks: () => ipcRenderer.invoke(Ipc.localList) as Promise<SearchHit[]>,
  addLocalTracks: () => ipcRenderer.invoke(Ipc.localAdd) as Promise<SearchHit[]>,
  pickBackdrop: () => ipcRenderer.invoke(Ipc.backdropPick) as Promise<string | null>,
  backdropUrl: () => ipcRenderer.invoke(Ipc.backdropUrl) as Promise<string | null>,
  pickFont: () => ipcRenderer.invoke(Ipc.fontPick) as Promise<{ family: string; dataUrl: string } | null>,
  fontFace: () => ipcRenderer.invoke(Ipc.fontFace) as Promise<{ family: string; dataUrl: string } | null>,
};

contextBridge.exposeInMainWorld("tide", tide);
