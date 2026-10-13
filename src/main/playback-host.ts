import { ipcMain, type BrowserWindow } from "electron";
import { PlaybackMachine } from "../core/playback/machine";
import { Ipc, type PlaybackBusEvent, type PlaybackSnapshot, type QueueRequest, type Track } from "../shared/contract";

const TICK_MS = 250;
const MAX_QUEUE = 500;
const MAX_TEXT = 300;

export function attachPlayback(getWindow: () => BrowserWindow | null, machine: PlaybackMachine): () => void {
  const send = (channel: string, payload: unknown) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channel, payload);
  };

  const publish = (snapshot: PlaybackSnapshot) => send(Ipc.playback, snapshot);

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

  const timer = setInterval(() => {
    if (machine.getState().status !== "playing") return;
    machine.tick(TICK_MS);
    publish(machine.getState());
  }, TICK_MS);

  ipcMain.handle(Ipc.playbackGet, () => machine.getState());
  ipcMain.handle(Ipc.play, () => machine.play());
  ipcMain.handle(Ipc.pause, () => machine.pause());
  ipcMain.handle(Ipc.seek, (_event, positionMs: unknown) => {
    if (typeof positionMs !== "number") return machine.getState();
    return machine.seek(positionMs);
  });
  ipcMain.handle(Ipc.volume, (_event, volume: unknown) => {
    if (typeof volume !== "number") return machine.getState();
    return machine.setVolume(volume);
  });
  ipcMain.handle(Ipc.queue, (_event, request: unknown) => {
    const parsed = parseQueueRequest(request);
    if (!parsed) return machine.getState();
    return machine.setQueue(parsed.queue, parsed.index ?? 0);
  });
  ipcMain.handle(Ipc.track, (_event, index: unknown) => {
    if (typeof index !== "number") return machine.getState();
    return machine.changeTrack(index);
  });

  return () => {
    clearInterval(timer);
    for (const unsubscribe of unsubscribers) unsubscribe();
    ipcMain.removeHandler(Ipc.playbackGet);
    ipcMain.removeHandler(Ipc.play);
    ipcMain.removeHandler(Ipc.pause);
    ipcMain.removeHandler(Ipc.seek);
    ipcMain.removeHandler(Ipc.volume);
    ipcMain.removeHandler(Ipc.queue);
    ipcMain.removeHandler(Ipc.track);
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
