import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { Ipc, type HealthStatus, type PlaybackBusEvent, type PlaybackSnapshot, type QueueRequest, type TideBridge, type Track } from "../shared/contract";

function listen<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const tide: TideBridge = {
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
};

contextBridge.exposeInMainWorld("tide", tide);
