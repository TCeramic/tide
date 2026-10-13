import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AudioLevel } from "../core/audio-level";
import { mediaKeyMode, type MediaShortcutMap } from "../core/media-keys";
import { Ipc, type ApiFailure, type Appearance, type HealthStatus, type LyricPayload, type MediaCue, type PlaybackBusEvent, type PlaybackSnapshot, type QrCheck, type QrTicket, type QueueRequest, type SearchHit, type SearchResult, type SessionSnapshot, type TideBridge, type TideToday, type Track } from "../shared/contract";

function listen<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const tide: TideBridge = {
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
  search: (keywords, type) => ipcRenderer.invoke(Ipc.search, keywords, type ?? 1) as Promise<SearchResult | ApiFailure>,
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
  getMediaShortcuts: () => ipcRenderer.invoke(Ipc.mediaShortcutsGet) as Promise<{ shortcuts: MediaShortcutMap; messages: string[] }>,
  setMediaShortcuts: (shortcuts) => ipcRenderer.invoke(Ipc.mediaShortcutsSet, shortcuts) as Promise<{ shortcuts: MediaShortcutMap; messages: string[] }>,
  hardwareKey: (action) => ipcRenderer.invoke(Ipc.hardwareKey, action) as Promise<PlaybackSnapshot>,
  likeSong: (id, like) => ipcRenderer.invoke(Ipc.likeSong, id, like) as Promise<ApiFailure | { ok: true; message: string }>,
  collectSong: (playlistId, trackId) => ipcRenderer.invoke(Ipc.collectSong, playlistId, trackId) as Promise<ApiFailure | { ok: true; message: string }>,
  playNext: (hit: SearchHit) => ipcRenderer.invoke(Ipc.playNext, hit) as Promise<PlaybackSnapshot>,
  next: () => ipcRenderer.invoke(Ipc.next) as Promise<PlaybackSnapshot>,
  previous: () => ipcRenderer.invoke(Ipc.previous) as Promise<PlaybackSnapshot>,
  setMode: (patch) => ipcRenderer.invoke(Ipc.mode, patch) as Promise<PlaybackSnapshot>,
  onNotice: (listener) => listen<string>(Ipc.notice, listener),
  playlistTracks: (id) => ipcRenderer.invoke(Ipc.playlistTracks, id) as Promise<SearchResult | ApiFailure>,
  dailyRecommend: () => ipcRenderer.invoke(Ipc.daily) as Promise<SearchResult | ApiFailure>,
  radar: () => ipcRenderer.invoke(Ipc.radar) as Promise<SearchResult | ApiFailure>,
  tideToday: () => ipcRenderer.invoke(Ipc.tideToday) as Promise<TideToday | ApiFailure>,
  playHits: (hits, index) => ipcRenderer.invoke(Ipc.playHits, hits, index) as Promise<PlaybackSnapshot>,
  onMedia: (listener) => listen<MediaCue>(Ipc.media, listener),
  reportProgress: (positionMs) => {
    ipcRenderer.send(Ipc.progress, positionMs);
  },
  ended: () => ipcRenderer.invoke(Ipc.ended) as Promise<PlaybackSnapshot>,
  failPlayback: (code) => ipcRenderer.invoke(Ipc.fail, code) as Promise<PlaybackSnapshot>,
  onAppearance: (listener) => listen<Appearance>(Ipc.appearance, listener),
};

contextBridge.exposeInMainWorld("tide", tide);
