import { EventBus } from "../core/events";
import type { PlaybackEvents } from "../core/playback/types";
import { isThemeId, type Appearance, type PlaybackBusEvent, type PlaybackSnapshot, type TideBridge } from "../shared/contract";
import { createRafClock } from "./clock";
import { mountChrome } from "./layers/chrome";
import { mountLibrary } from "./layers/library";
import { mountLyrics } from "./layers/lyrics";
import { installMediaSession, syncMediaSession } from "./media-session";
import { mountPlayer } from "./player";
import { mountStage } from "./layers/stage";

declare global {
  interface Window {
    tide: TideBridge;
  }
}

const stage = document.querySelector<HTMLElement>("#stage");
const lyrics = document.querySelector<HTMLElement>("#lyrics");
const chrome = document.querySelector<HTMLElement>("#chrome");

if (!stage || !lyrics || !chrome) {
  throw new Error("Tide renderer is missing a layer root");
}

const chromeRoot = chrome;

const PLAYBACK_LABEL = {
  idle: "空闲",
  loading: "载入",
  playing: "播放中",
  paused: "已暂停",
  error: "出错",
} as const;

function showPlayback(snapshot: PlaybackSnapshot): void {
  playingNow = snapshot.status === "playing";
  stageLayer.setScene({ level: Number.parseFloat(document.documentElement.style.getPropertyValue("--tide-stage")) || 0, motion: motionAmount, playing: playingNow });
  chromeLayer.setPlayback(snapshot);
  const track = snapshot.index >= 0 ? (snapshot.queue[snapshot.index] ?? null) : null;
  lyricsLayer.setTrack(track);
  lyricsLayer.setPosition(snapshot.positionMs);
  library.setPlayback(PLAYBACK_LABEL[snapshot.status]);
  library.setQueue(snapshot);
  syncMediaSession(snapshot);
}

installMediaSession();

const stageLayer = mountStage(stage);
const lyricsLayer = mountLyrics(lyrics);
const chromeLayer = mountChrome(chrome);
const library = mountLibrary(chrome);
const stopPlayer = mountPlayer();

const bus = new EventBus<PlaybackEvents>();
bus.on("track-change", (payload) => {
  const track = payload.snapshot.queue[payload.index] ?? null;
  lyricsLayer.setTrack(track);
});

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let stopClock = (): void => undefined;
let motionOn = false;
let motionAmount = 1;
let playingNow = false;

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function setStageMotion(level: number, motion: number): void {
  const stage = clamp01(level, 1);
  motionAmount = clamp01(motion, 1);
  document.documentElement.style.setProperty("--tide-stage", String(stage));
  stageLayer.setScene({ level: stage, motion: motionAmount, playing: playingNow });
  const wantMotion = stage > 0 && motionAmount > 0 && !reduceMotion;
  if (wantMotion === motionOn) {
    if (!wantMotion) document.documentElement.style.setProperty("--tide-phase", "0.5");
    return;
  }
  motionOn = wantMotion;
  stopClock();
  if (!wantMotion) {
    document.documentElement.style.setProperty("--tide-phase", "0.5");
    stopClock = () => undefined;
    return;
  }
  stopClock = createRafClock((frame) => {
    const raw = (frame.elapsedMs % 12000) / 12000;
    const phase = 0.5 + (raw - 0.5) * motionAmount;
    document.documentElement.style.setProperty("--tide-phase", phase.toFixed(4));
  });
}

function applyAppearance(appearance: Appearance): void {
  document.documentElement.dataset.theme = isThemeId(appearance.theme) ? appearance.theme : "tide";
  chromeRoot.hidden = !appearance.chromeVisible;
  setStageMotion(appearance.stageLevel, appearance.motion);
}

applyAppearance({ chromeVisible: true, stageLevel: 1, theme: "tide", motion: 1 });
window.tide.onAppearance(applyAppearance);

window.tide.onEvent((event: PlaybackBusEvent) => {
  switch (event.type) {
    case "play":
      bus.emit("play", { snapshot: event.snapshot });
      break;
    case "pause":
      bus.emit("pause", { snapshot: event.snapshot });
      break;
    case "seek":
      bus.emit("seek", { positionMs: event.positionMs, snapshot: event.snapshot });
      break;
    case "volume":
      bus.emit("volume", { volume: event.volume, snapshot: event.snapshot });
      break;
    case "queue":
      bus.emit("queue", { snapshot: event.snapshot });
      break;
    case "track-change":
      bus.emit("track-change", { index: event.index, snapshot: event.snapshot });
      break;
    default:
      break;
  }
});

window.tide.onPlayback(showPlayback);
window.tide.onNotice((message) => library.notify(message));

window.tide.onHealth((status) => {
  chromeLayer.setHealth(status);
  library.setApiReady(status.ok);
  library.setBusPort(status.busPort);
});

void window.tide.getPlayback().then(showPlayback);

void window.tide.getHealth().then((status) => {
  chromeLayer.setHealth(status);
  library.setApiReady(status.ok);
  library.setBusPort(status.busPort);
});

window.addEventListener("beforeunload", () => {
  stopClock();
  stageLayer.destroy();
  lyricsLayer.destroy();
  chromeLayer.destroy();
  library.destroy();
  stopPlayer();
});
