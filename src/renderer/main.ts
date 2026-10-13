import { EventBus } from "../core/events";
import type { PlaybackEvents } from "../core/playback/types";
import type { Appearance, PlaybackBusEvent, TideBridge } from "../shared/contract";
import { createRafClock } from "./clock";
import { mountChrome } from "./layers/chrome";
import { mountLibrary } from "./layers/library";
import { mountLyrics } from "./layers/lyrics";
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

const stopStage = mountStage(stage);
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

function setStageMotion(level: number): void {
  document.documentElement.style.setProperty("--tide-stage", String(Math.min(1, Math.max(0, level))));
  const wantMotion = level > 0 && !reduceMotion;
  if (wantMotion === motionOn) return;
  motionOn = wantMotion;
  stopClock();
  if (!wantMotion) {
    document.documentElement.style.setProperty("--tide-phase", "0.5");
    stopClock = () => undefined;
    return;
  }
  stopClock = createRafClock((frame) => {
    const phase = (frame.elapsedMs % 12000) / 12000;
    document.documentElement.style.setProperty("--tide-phase", phase.toFixed(4));
  });
}

function applyAppearance(appearance: Appearance): void {
  chromeRoot.hidden = !appearance.chromeVisible;
  setStageMotion(appearance.stageLevel);
}

applyAppearance({ chromeVisible: true, stageLevel: 1 });
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

window.tide.onPlayback((snapshot) => {
  chromeLayer.setPlayback(snapshot);
  const track = snapshot.index >= 0 ? (snapshot.queue[snapshot.index] ?? null) : null;
  lyricsLayer.setTrack(track);
});

window.tide.onHealth((status) => {
  chromeLayer.setHealth(status);
  library.setApiReady(status.ok);
});

void window.tide.getPlayback().then((snapshot) => {
  chromeLayer.setPlayback(snapshot);
  const track = snapshot.index >= 0 ? (snapshot.queue[snapshot.index] ?? null) : null;
  lyricsLayer.setTrack(track);
});

void window.tide.getHealth().then((status) => {
  chromeLayer.setHealth(status);
  library.setApiReady(status.ok);
});

window.addEventListener("beforeunload", () => {
  stopClock();
  stopStage();
  lyricsLayer.destroy();
  chromeLayer.destroy();
  library.destroy();
  stopPlayer();
});
