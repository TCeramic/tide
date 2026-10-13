import { ipcMain, type BrowserWindow, type IpcMainEvent } from "electron";
import { queueFromHits } from "../core/playback/hits";
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
  playHits(hits: unknown, index: number): Promise<PlaybackSnapshot | null>;
  next(): Promise<PlaybackSnapshot>;
  previous(): Promise<PlaybackSnapshot>;
}

const MAX_QUEUE = 500;
const MAX_HITS = 100;
const MAX_TEXT = 300;
const PROGRESS_MS = 200;

export function attachPlayback(
  getWindow: () => BrowserWindow | null,
  machine: PlaybackMachine,
  getPort: () => number | null,
  persistVolume?: (volume: number) => void,
  listenLog?: ListenLog,
): { detach: () => void; control: PlaybackControl } {
  let generation = 0;
  let currentMedia: { trackId: string; url: string } | null = null;
  let progressAt = 0;

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
    const body = port == null ? null : await loopbackJson(port, "GET", `/song/url?id=${encodeURIComponent(track.id)}`);
    if (token !== generation) return machine.getState();
    const media = readMediaBody(body);
    if (!media.url) {
      currentMedia = null;
      sendMedia(track.id, null);
      return publish(machine.fail(media.signedOut ? "signed_out" : "no_url"));
    }
    currentMedia = { trackId: track.id, url: media.url };
    sendMedia(track.id, media.url);
    const loaded = machine.completeLoad();
    if (loaded.status === "playing") remember("play", track);
    return loaded;
  }

  const goTo = (index: number): Promise<PlaybackSnapshot> => {
    const before = machine.getState();
    const forward = Number.isInteger(index) && index > before.index && index < before.queue.length;
    if (forward) noteSkip(before);
    const live = before.status === "playing" || before.status === "loading";
    const next = machine.changeTrack(index);
    if (next.status === "error") return Promise.resolve(publish(next));
    currentMedia = null;
    const track = next.index >= 0 ? next.queue[next.index] : undefined;
    if (!live) {
      if (track) sendMedia(track.id, null);
      return Promise.resolve(next);
    }
    generation += 1;
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
      currentMedia = null;
      return machine.setQueue(parsed.queue, parsed.index ?? 0);
    },
    track: (index) => goTo(index),
    playHits: (hits, index) => {
      const parsed = parseHits(hits);
      if (!parsed || typeof index !== "number") return Promise.resolve(null);
      const queued = queueFromHits(parsed, index);
      if (!queued) return Promise.resolve(null);
      noteSkip(machine.getState());
      currentMedia = null;
      machine.setQueue(queued.tracks, queued.index);
      generation += 1;
      return loadCurrent(generation);
    },
    next: () => goTo(machine.getState().index + 1),
    previous: () => goTo(machine.getState().index - 1),
  };

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
  ipcMain.handle(Ipc.playHits, async (_event, hits: unknown, index: unknown) => {
    if (typeof index !== "number") return control.get();
    return (await control.playHits(hits, index)) ?? control.get();
  });
  ipcMain.handle(Ipc.ended, () => {
    const state = machine.getState();
    if (state.status !== "playing") return state;
    const track = state.index >= 0 ? state.queue[state.index] : undefined;
    if (!track) return state;
    const following = state.index + 1;
    if (following >= state.queue.length) {
      machine.syncPosition(track.durationMs);
      return machine.pause();
    }
    const changed = machine.changeTrack(following);
    if (changed.status === "error") return publish(changed);
    currentMedia = null;
    generation += 1;
    return loadCurrent(generation);
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
  ipcMain.handle(Ipc.tideToday, async () => {
    try {
      return await loadTideToday(getPort(), listenLog?.read() ?? []);
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
      ipcMain.removeHandler(Ipc.playbackGet);
      ipcMain.removeHandler(Ipc.play);
      ipcMain.removeHandler(Ipc.pause);
      ipcMain.removeHandler(Ipc.seek);
      ipcMain.removeHandler(Ipc.volume);
      ipcMain.removeHandler(Ipc.queue);
      ipcMain.removeHandler(Ipc.track);
      ipcMain.removeHandler(Ipc.playHits);
      ipcMain.removeHandler(Ipc.ended);
      ipcMain.removeHandler(Ipc.fail);
      ipcMain.removeHandler(Ipc.tideToday);
    },
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function readMediaBody(body: unknown): { url: string | null; signedOut: boolean } {
  if (!body || typeof body !== "object") return { url: null, signedOut: false };
  const record = body as { error?: unknown; url?: unknown; signedOut?: unknown };
  if (record.signedOut === true || record.error === "signed_out") return { url: null, signedOut: true };
  if (typeof record.url === "string" && isHttpUrl(record.url)) return { url: record.url, signedOut: false };
  return { url: null, signedOut: false };
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
  if (typeof candidate.id !== "string" || !/^\d{1,20}$/.test(candidate.id)) return null;
  if (!isShortText(candidate.title) || !isShortText(candidate.artist)) return null;
  if (typeof candidate.durationMs !== "number" || !Number.isFinite(candidate.durationMs)) return null;
  if (candidate.durationMs < 0 || candidate.durationMs > 24 * 60 * 60 * 1000) return null;
  if (typeof candidate.playable !== "boolean") return null;
  return {
    id: candidate.id,
    title: candidate.title,
    artist: candidate.artist,
    durationMs: Math.trunc(candidate.durationMs),
    playable: candidate.playable,
  };
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
  };
}

function isShortText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT;
}
