import { ipcMain, type BrowserWindow, type IpcMainEvent } from "electron";
import { AUDIO_LEVEL_LABEL, isAudioLevel } from "../core/audio-level";
import { queueFromHits } from "../core/playback/hits";
import { profileSeeds, randomProfileMatch } from "../core/explore-queue";
import { PlaybackMachine } from "../core/playback/machine";
import { countsAsSkip, type ListenKind } from "../core/tide-today";
import { ListenLog } from "./listen-log";
import { loadTideToday } from "./tide-today";
import { loopbackJson } from "./session-host";
import {
  Ipc,
  type ApiFailure,
  type MediaCue,
  type PlaybackBusEvent,
  type PlaybackSnapshot,
  type QueueRequest,
  type PlaylistCursor,
  type SearchHit,
  type Track,
} from "../shared/contract";

export interface PlaybackControl {
  get(): PlaybackSnapshot;
  play(): Promise<PlaybackSnapshot>;
  pause(): PlaybackSnapshot;
  seek(positionMs: number): PlaybackSnapshot;
  setVolume(volume: number, persist: boolean): PlaybackSnapshot;
  queue(request: unknown): PlaybackSnapshot | null;
  track(index: number): Promise<PlaybackSnapshot>;
  playHits(hits: unknown, index: number, source?: unknown): Promise<PlaybackSnapshot | null>;
  playNext(hit: unknown): PlaybackSnapshot | null;
  setMode(patch: { repeat?: "off" | "all" | "one"; shuffle?: boolean; explore?: boolean }): PlaybackSnapshot;
  next(): Promise<PlaybackSnapshot>;
  previous(): Promise<PlaybackSnapshot>;
  stop(): PlaybackSnapshot;
  removeAt(index: number): Promise<PlaybackSnapshot>;
  moveTrack(from: number, to: number): PlaybackSnapshot;
  clearQueue(): PlaybackSnapshot;
}

const MAX_QUEUE = 20000;
const MAX_HITS = 20000;
const MAX_TEXT = 300;
const PROGRESS_MS = 200;

export function attachPlayback(
  getWindow: () => BrowserWindow | null,
  machine: PlaybackMachine,
  getPort: () => number | null,
  persistVolume?: (volume: number) => void,
  listenLog?: ListenLog,
  getQuality?: () => string,
): { detach: () => void; control: PlaybackControl } {
  let generation = 0;
  let currentMedia: { trackId: string; url: string } | null = null;
  let progressAt = 0;
  let queueVersion = 0;
  let source: PlaylistCursor | null = null;
  let profile: SearchHit[] = [];
  let round = Math.floor(Math.random() * 10000);
  let recommendationVersion = 0;
  let inspiredKey = "";
  const recommendedIds = new Set<string>();
  const recentRecommendations = new Set<string>();
  let paging: Promise<void> | null = null;
  let inspiring: Promise<void> | null = null;
  const resetSource = (hits: SearchHit[], cursor?: unknown) => {
    queueVersion++; recommendationVersion++; inspiredKey = ""; recommendedIds.clear(); profile = hits; source = parseCursor(cursor); round = Math.floor(Math.random() * 10000); paging = null; inspiring = null;
  };

  const send = (channel: string, payload: unknown) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channel, payload);
  };

  const publish = (snapshot: PlaybackSnapshot) => {
    send(Ipc.playback, snapshot);
    return snapshot;
  };

  const sendMedia = (trackId: string, url: string | null) => {
    const cue: MediaCue = { trackId, url };
    send(Ipc.media, cue);
  };

  const remember = (kind: ListenKind, track: Track | undefined) => {
    if (!listenLog || !track) return;
    try {
      listenLog.append(kind, track);
    } catch {
      // A failed write must not stop playback.
    }
  };

  const noteSkip = (before: PlaybackSnapshot) => {
    if (!countsAsSkip(before.status, before.positionMs)) return;
    const track = before.index >= 0 ? before.queue[before.index] : undefined;
    remember("skip", track);
  };

  const unsubscribers = (
    [
      "play",
      "pause",
      "seek",
      "volume",
      "queue",
      "track-change",
    ] as const
  ).map((type) =>
    machine.events.on(type, (payload) => {
      const event = { type, ...payload } as PlaybackBusEvent;
      send(Ipc.bus, event);
      publish(event.snapshot);
    }),
  );

  async function loadCurrent(token: number): Promise<PlaybackSnapshot> {
    const state = machine.getState();
    const track = state.index >= 0 ? state.queue[state.index] : undefined;
    if (!track) {
      currentMedia = null;
      return publish(machine.fail("empty_queue"));
    }
    if (state.status !== "loading") publish(machine.beginLoad());
    currentMedia = null;
    sendMedia(track.id, null);
    const port = getPort();
    const requested = isAudioLevel(getQuality?.()) ? getQuality?.() : "standard";
    const level = isAudioLevel(requested) ? requested : "standard";
    const body = port == null
      ? null
      : await loopbackJson(port, "GET", `/song/url?id=${encodeURIComponent(track.id)}&level=${level}`);
    if (token !== generation) return machine.getState();
    const media = readMediaBody(body);
    if (!media.url) {
      currentMedia = null;
      sendMedia(track.id, null);
      if (media.signedOut) send(Ipc.notice, "登录已过期，请重新登录");
      return publish(machine.fail(media.signedOut ? "signed_out" : "no_url"));
    }
    if (media.level && media.requested && media.level !== media.requested) {
      const from = isAudioLevel(media.requested) ? AUDIO_LEVEL_LABEL[media.requested] : media.requested;
      const to = isAudioLevel(media.level) ? AUDIO_LEVEL_LABEL[media.level] : media.level;
      send(Ipc.notice, `这一首没有${from}，已改用${to}。`);
    }
    currentMedia = { trackId: track.id, url: media.url };
    sendMedia(track.id, media.url);
    const loaded = machine.completeLoad();
    if (loaded.status === "playing") remember("play", track);
    return loaded;
  }

  const goTo = (index: number): Promise<PlaybackSnapshot> => {
    recommendationVersion++; inspiredKey = "";
    const before = machine.getState();
    const forward = Number.isInteger(index) && index > before.index && index < before.queue.length;
    if (forward) noteSkip(before);
    const live = before.status === "playing" || before.status === "loading";
    const next = machine.changeTrack(index);
    if (next.status === "error") return Promise.resolve(publish(next));
    currentMedia = null;
    const track = next.index >= 0 ? next.queue[next.index] : undefined;
    if (!live) {
      void extendExplore();
      if (track) sendMedia(track.id, null);
      return Promise.resolve(next);
    }
    generation += 1;
    void extendExplore();
    return loadCurrent(generation);
  };

  const control: PlaybackControl = {
    get: () => machine.getState(),
    play: () => {
      const state = machine.getState();
      if (state.status === "playing" || state.status === "loading") return Promise.resolve(state);
      const track = state.index >= 0 ? state.queue[state.index] : undefined;
      if (state.status === "paused" && track && currentMedia?.trackId === track.id) {
        return Promise.resolve(machine.resume());
      }
      generation += 1;
      return loadCurrent(generation);
    },
    pause: () => machine.pause(),
    seek: (positionMs) => machine.seek(positionMs),
    setVolume: (volume, persist) => {
      if (!Number.isFinite(volume)) return machine.getState();
      const snapshot = machine.setVolume(volume);
      if (persist) persistVolume?.(snapshot.volume);
      return snapshot;
    },
    queue: (request) => {
      const parsed = parseQueueRequest(request);
      if (!parsed) return null;
      resetSource(parsed.queue.map(track => ({ ...track, playable: true })));
      currentMedia = null;
      return machine.setQueue(parsed.queue, parsed.index ?? 0);
    },
    track: (index) => goTo(index),
    playHits: (hits, index, cursor) => {
      const parsed = parseHits(hits);
      if (!parsed || typeof index !== "number") return Promise.resolve(null);
      const queued = queueFromHits(parsed, index);
      if (!queued) return Promise.resolve(null);
      resetSource(parsed, cursor);
      noteSkip(machine.getState());
      currentMedia = null;
      machine.setQueue(queued.tracks, queued.index);
      generation += 1;
      void extendExplore();
      return loadCurrent(generation);
    },
    playNext: (hit) => {
      const parsed = parseHit(hit);
      if (!parsed) return null;
      noteSkip(machine.getState());
      const track: Track = {
        id: parsed.id,
        title: parsed.title,
        artist: parsed.artist,
        durationMs: parsed.durationMs,
        albumTitle: parsed.albumTitle, albumId: parsed.albumId,
      };
      if (parsed.cover) track.cover = parsed.cover;
      return machine.insertNext(track);
    },
    setMode: (patch) => {
      if (patch.repeat) machine.setRepeat(patch.repeat);
      if (typeof patch.shuffle === "boolean") machine.setShuffle(patch.shuffle);
      if (typeof patch.explore === "boolean") machine.setExplore(patch.explore);
      recommendationVersion++; inspiredKey = "";
      if (!machine.getState().explore) dropFutureRecommendations();
      const snapshot = publish(machine.getState());
      if (snapshot.explore) void extendExplore();
      return snapshot;
    },
    next: async () => {
      await extendPlaylist();
      const state = machine.getState();
      const token = recommendationVersion;
      if (state.explore) await extendExplore();
      if (token !== recommendationVersion) return machine.getState();
      const index = machine.nextIndex();
      if (index == null) return machine.getState();
      return goTo(index);
    },
    previous: () => {
      const index = machine.previousIndex();
      if (index == null) return Promise.resolve(machine.getState());
      return goTo(index);
    },
    stop: () => {
      generation += 1;
      return publish(machine.stop());
    },
    removeAt: (index) => reloadIfTrackChanged(() => machine.removeAt(index)),
    moveTrack: (from, to) => {
      const beforeId = currentId();
      const next = machine.moveTrack(from, to);
      if (next.queue.length === 0) stopMedia();
      else if (liveStatus() && beforeId !== currentId()) {
        generation += 1;
        void loadCurrent(generation);
      }
      return next;
    },
    clearQueue: () => {
      resetSource([]);
      stopMedia();
      return machine.clearQueue();
    },
  };

  const currentId = () => {
    const state = machine.getState();
    return state.index >= 0 ? state.queue[state.index]?.id : undefined;
  };
  const liveStatus = () => {
    const status = machine.getState().status;
    return status === "playing" || status === "loading";
  };
  const stopMedia = () => {
    currentMedia = null;
    generation += 1;
    sendMedia("", null);
  };
  const reloadIfTrackChanged = (edit: () => PlaybackSnapshot): Promise<PlaybackSnapshot> => {
    const beforeId = currentId();
    const live = liveStatus();
    const next = edit();
    if (next.queue.length === 0) {
      stopMedia();
      return Promise.resolve(next);
    }
    if (live && beforeId !== currentId()) {
      currentMedia = null;
      generation += 1;
      return loadCurrent(generation);
    }
    return Promise.resolve(next);
  };

  async function extendPlaylist(): Promise<void> {
    const state = machine.getState();
    if (!source?.hasMore || state.queue.length - state.index - 1 > 10) return;
    if (paging) return paging;
    const token = queueVersion;
    const cursor = source;
    const job = (async () => {
      // Skip unavailable-only pages without treating the playlist as finished.
      for (let attempt = 0; attempt < 3 && cursor.hasMore; attempt++) {
        const body = await loopbackJson(getPort(), "GET", `/playlist/tracks?id=${cursor.playlistId}&offset=${cursor.offset}`);
        if (token !== queueVersion) return;
        const next = parseCursor((body as { source?: unknown } | null)?.source);
        if (!body || (body as { ok?: boolean }).ok !== true || !next || next.offset <= cursor.offset) {
          if (body && (body as { ok?: boolean }).ok === true) cursor.hasMore = false;
          else send(Ipc.notice, "歌单续读暂时失败，将在下一首重试");
          return;
        }
        const hits = readSimilarHits(body);
        cursor.offset = next.offset; cursor.hasMore = next.hasMore;
        const known = new Set(profile.map(hit => hit.id));
        const fresh = hits.filter(hit => !known.has(hit.id));
        if (!fresh.length && hits.length) { cursor.hasMore = false; return; }
        profile.push(...fresh);
        const queued = new Set(machine.getState().queue.map(track => track.id));
        const playable = fresh.filter(hit => hit.playable && !queued.has(hit.id));
        if (playable.length) { publish(machine.appendTracks(playable.map(asTrack))); return; }
      }
    })();
    paging = job;
    try { await job; } finally { if (paging === job) paging = null; }
  }

  function dropFutureRecommendations(): void {
    const state = machine.getState();
    for (let i = state.queue.length - 1; i > state.index; i--) {
      if (recommendedIds.has(state.queue[i].id)) machine.removeAt(i);
    }
  }

  async function extendExplore(): Promise<void> {
    await extendPlaylist();
    const state = machine.getState();
    if (!state.explore || state.index < 0) return;
    const key = `${queueVersion}:${recommendationVersion}`;
    if (inspiredKey === key) return inspiring ?? undefined;
    inspiredKey = key;
    dropFutureRecommendations();
    const token = queueVersion;
    const trackToken = recommendationVersion;
    const job = (async () => {
      const likedBody = await loopbackJson(getPort(), "GET", "/liked");
      const liked = new Set<string>(Array.isArray((likedBody as { ids?: unknown } | null)?.ids) ? (likedBody as { ids: string[] }).ids : []);
      const likesKnown = (likedBody as { known?: boolean } | null)?.known === true;
      const taste = profile.length ? profile.map(hit => ({ ...hit, liked: likesKnown ? liked.has(hit.id) : hit.liked })) : state.queue;
      const seeds = profileSeeds(taste, liked, round++);
      const groups = await Promise.all(seeds.map(async seed => ({ weight: seed.weight,
        hits: readSimilarHits(await loopbackJson(getPort(), "GET", `/similar?id=${encodeURIComponent(seed.id)}`)) })));
      if (token !== queueVersion || trackToken !== recommendationVersion || !machine.getState().explore) return;
      const queued = new Set(machine.getState().queue.map(track => track.id));
      const hit = randomProfileMatch(groups, queued, recentRecommendations);
      if (!hit) { send(Ipc.notice, "暂时没有更多相似歌曲，灵感模式保留现有队列。"); return; }
      recommendedIds.add(hit.id); recentRecommendations.add(hit.id);
      if (recentRecommendations.size > 100) recentRecommendations.delete(recentRecommendations.values().next().value!);
      publish(machine.insertNext(asTrack(hit)));
    })();
    inspiring = job;
    try { await job; } finally { if (inspiring === job) inspiring = null; }
  }

  ipcMain.handle(Ipc.playbackGet, () => control.get());
  ipcMain.handle(Ipc.play, () => control.play());
  ipcMain.handle(Ipc.pause, () => control.pause());
  ipcMain.handle(Ipc.seek, (_event, positionMs: unknown) => (
    typeof positionMs === "number" ? control.seek(positionMs) : control.get()
  ));
  ipcMain.handle(Ipc.volume, (_event, volume: unknown) => (
    typeof volume === "number" ? control.setVolume(volume, true) : control.get()
  ));
  ipcMain.handle(Ipc.queue, (_event, request: unknown) => control.queue(request) ?? control.get());
  ipcMain.handle(Ipc.track, (_event, index: unknown) => (
    typeof index === "number" ? control.track(index) : control.get()
  ));
  ipcMain.handle(Ipc.playHits, async (_event, hits: unknown, index: unknown, source: unknown) => {
    if (typeof index !== "number") return control.get();
    return (await control.playHits(hits, index, source)) ?? control.get();
  });
  ipcMain.handle(Ipc.ended, async () => {
    await extendPlaylist();
    const before = machine.getState();
    if (before.status !== "playing") return before;
    const token = recommendationVersion;
    if (before.explore) await extendExplore();
    if (token !== recommendationVersion || machine.getState().status !== "playing") return machine.getState();
    const finished = machine.finish();
    recommendationVersion++; inspiredKey = "";
    if (finished.status !== "playing") return publish(finished);
    currentMedia = null;
    generation += 1;
    void extendExplore();
    return loadCurrent(generation);
  });
  ipcMain.handle(Ipc.playNext, (_event, hit: unknown) => control.playNext(hit) ?? control.get());
  ipcMain.handle(Ipc.next, () => control.next());
  ipcMain.handle(Ipc.previous, () => control.previous());
  ipcMain.handle(Ipc.queueRemove, (_event, index: unknown) => (
    typeof index === "number" ? control.removeAt(index) : control.get()
  ));
  ipcMain.handle(Ipc.queueMove, (_event, from: unknown, to: unknown) => (
    typeof from === "number" && typeof to === "number" ? control.moveTrack(from, to) : control.get()
  ));
  ipcMain.handle(Ipc.queueClear, () => control.clearQueue());
  ipcMain.handle(Ipc.mode, (_event, patch: unknown) => {
    if (!patch || typeof patch !== "object") return control.get();
    const record = patch as { repeat?: unknown; shuffle?: unknown; explore?: unknown };
    const repeat = record.repeat === "off" || record.repeat === "all" || record.repeat === "one"
      ? record.repeat
      : undefined;
    return control.setMode({
      repeat,
      shuffle: typeof record.shuffle === "boolean" ? record.shuffle : undefined,
      explore: typeof record.explore === "boolean" ? record.explore : undefined,
    });
  });
  ipcMain.handle(Ipc.fail, (_event, code: unknown) => {
    if (code !== "no_url" && code !== "signed_out") return machine.getState();
    generation += 1;
    currentMedia = null;
    const state = machine.getState();
    const track = state.index >= 0 ? state.queue[state.index] : undefined;
    if (track) sendMedia(track.id, null);
    return publish(machine.fail(code));
  });

  const onProgress = (_event: IpcMainEvent, positionMs: unknown) => {
    if (typeof positionMs !== "number") return;
    machine.syncPosition(positionMs);
    const now = Date.now();
    if (now - progressAt < PROGRESS_MS) return;
    progressAt = now;
    publish(machine.getState());
  };
  ipcMain.on(Ipc.progress, onProgress);
  const onDuration = (_event: IpcMainEvent, id: unknown, durationMs: unknown) => {
    if (typeof id === "string" && typeof durationMs === "number" && currentMedia?.trackId === id) machine.reportDuration(id, durationMs);
  };
  ipcMain.on(Ipc.duration, onDuration);
  let todayIds: string[] = [];
  ipcMain.handle(Ipc.replaceUpcoming, (_event, raw: unknown) => {
    const hits = parseHits(raw);
    if (!hits || !hits.length) return machine.getState();
    resetSource(hits);
    const snapshot = machine.replaceUpcoming(hits.filter(hit => hit.playable).map(asTrack));
    void extendExplore(); return snapshot;
  });
  ipcMain.handle(Ipc.tideToday, async (_event, refresh: unknown) => {
    try {
      const result = await loadTideToday(getPort(), listenLog?.read() ?? [], refresh === true, todayIds);
      if (result.hits.length) todayIds = result.hits.map(hit => hit.id); return result;
    } catch {
      return { ok: false, error: "tide_today", message: "今日潮汐暂时没有整理出来" } satisfies ApiFailure;
    }
  });

  return {
    control,
    detach: () => {
      generation += 1;
      for (const unsubscribe of unsubscribers) unsubscribe();
      ipcMain.removeListener(Ipc.progress, onProgress);
      ipcMain.removeListener(Ipc.duration, onDuration);
      ipcMain.removeHandler(Ipc.playbackGet);
      ipcMain.removeHandler(Ipc.play);
      ipcMain.removeHandler(Ipc.pause);
      ipcMain.removeHandler(Ipc.seek);
      ipcMain.removeHandler(Ipc.volume);
      ipcMain.removeHandler(Ipc.queue);
      ipcMain.removeHandler(Ipc.track);
      ipcMain.removeHandler(Ipc.playHits);
      ipcMain.removeHandler(Ipc.playNext);
      ipcMain.removeHandler(Ipc.next);
      ipcMain.removeHandler(Ipc.previous);
      ipcMain.removeHandler(Ipc.queueRemove);
      ipcMain.removeHandler(Ipc.queueMove);
      ipcMain.removeHandler(Ipc.queueClear);
      ipcMain.removeHandler(Ipc.mode);
      ipcMain.removeHandler(Ipc.ended);
      ipcMain.removeHandler(Ipc.fail);
      ipcMain.removeHandler(Ipc.tideToday);
      ipcMain.removeHandler(Ipc.replaceUpcoming);
    },
  };
}

function readSimilarHits(body: unknown): SearchHit[] {
  if (!body || typeof body !== "object" || (body as { ok?: unknown }).ok !== true) return [];
  const hits = (body as { hits?: unknown }).hits;
  if (!Array.isArray(hits)) return [];
  const parsed: SearchHit[] = [];
  for (const item of hits) {
    const hit = parseHit(item);
    if (hit) parsed.push(hit);
  }
  return parsed;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function readMediaBody(body: unknown): { url: string | null; signedOut: boolean; level?: string; requested?: string } {
  if (!body || typeof body !== "object") return { url: null, signedOut: false };
  const record = body as { error?: unknown; url?: unknown; signedOut?: unknown; level?: unknown; requested?: unknown };
  const level = typeof record.level === "string" ? record.level : undefined;
  const requested = typeof record.requested === "string" ? record.requested : undefined;
  if (record.signedOut === true || record.error === "signed_out") return { url: null, signedOut: true, level, requested };
  if (typeof record.url === "string" && isHttpUrl(record.url)) return { url: record.url, signedOut: false, level, requested };
  return { url: null, signedOut: false, level, requested };
}

function parseHits(value: unknown): SearchHit[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_HITS) return null;
  const hits: SearchHit[] = [];
  for (const item of value) {
    const hit = parseHit(item);
    if (!hit) return null;
    hits.push(hit);
  }
  return hits;
}

function parseHit(value: unknown): SearchHit | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !/^(\d{1,20}|local-[a-f0-9]{12})$/.test(candidate.id)) return null;
  if (!isShortText(candidate.title) || !isShortText(candidate.artist)) return null;
  if (typeof candidate.durationMs !== "number" || !Number.isFinite(candidate.durationMs)) return null;
  if (candidate.durationMs < 0 || candidate.durationMs > 24 * 60 * 60 * 1000) return null;
  if (typeof candidate.playable !== "boolean") return null;
  const hit: SearchHit = {
    id: candidate.id,
    title: candidate.title,
    artist: candidate.artist,
    durationMs: Math.trunc(candidate.durationMs),
    playable: candidate.playable,
  };
  if (typeof candidate.cover === "string" && /^https?:\/\//.test(candidate.cover)) hit.cover = candidate.cover.slice(0, 500);
  if (isShortText(candidate.albumTitle)) hit.albumTitle = candidate.albumTitle;
  if (typeof candidate.albumId === "string" && /^\d{1,20}$/.test(candidate.albumId)) hit.albumId = candidate.albumId;
  if (typeof candidate.liked === "boolean") hit.liked = candidate.liked;
  return hit;
}

function parseQueueRequest(request: unknown): QueueRequest | null {
  if (!request || typeof request !== "object") return null;
  const queue = (request as { queue?: unknown }).queue;
  const index = (request as { index?: unknown }).index;
  if (!Array.isArray(queue) || queue.length > MAX_QUEUE) return null;
  if (index !== undefined && (typeof index !== "number" || !Number.isInteger(index))) return null;
  const tracks: Track[] = [];
  for (const item of queue) {
    const track = parseTrack(item);
    if (!track) return null;
    tracks.push(track);
  }
  return { queue: tracks, index: index as number | undefined };
}

function parseTrack(value: unknown): Track | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!isShortText(candidate.id) || !isShortText(candidate.title) || !isShortText(candidate.artist)) {
    return null;
  }
  if (typeof candidate.durationMs !== "number" || !Number.isFinite(candidate.durationMs)) return null;
  if (candidate.durationMs < 0 || candidate.durationMs > 24 * 60 * 60 * 1000) return null;
  return {
    id: candidate.id,
    title: candidate.title,
    artist: candidate.artist,
    durationMs: candidate.durationMs,
    ...(isShortText(candidate.albumTitle) ? { albumTitle: candidate.albumTitle } : {}),
    ...(typeof candidate.albumId === "string" && /^\d{1,20}$/.test(candidate.albumId) ? { albumId: candidate.albumId } : {}),
    ...(typeof candidate.cover === "string" && /^https?:\/\//.test(candidate.cover) ? { cover: candidate.cover.slice(0, 500) } : {}),
  };
}

function isShortText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT;
}

function asTrack(hit: SearchHit): Track { return { id: hit.id, title: hit.title, artist: hit.artist, durationMs: hit.durationMs, cover: hit.cover, albumTitle: hit.albumTitle, albumId: hit.albumId }; }
function parseCursor(value: unknown): PlaylistCursor | null {
  if (!value || typeof value !== "object") return null;
  const v = value as PlaylistCursor;
  return typeof v.playlistId === "string" && /^\d{1,20}$/.test(v.playlistId) && Number.isSafeInteger(v.offset) && v.offset >= 0 && typeof v.hasMore === "boolean" ? { ...v } : null;
}
