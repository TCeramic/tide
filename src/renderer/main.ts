import { isRenderingActive, setRenderingActive, setThemeTransitionActive } from "./render-activity";
import { installModuleMotion } from "./module-motion";
import { mountCloseMenu } from "./close-menu";
import { EventBus } from "../core/events";
import type { PlaybackEvents } from "../core/playback/types";
import { isThemeId, type Appearance, type PlaybackBusEvent, type PlaybackSnapshot, type TideBridge } from "../shared/contract";
import { mountChrome } from "./layers/chrome";
import { mountLibrary } from "./layers/library";
import { mountLyrics } from "./layers/lyrics";
import { installMediaSession, syncMediaSession } from "./media-session";
import { mountPlayer } from "./player";
import { mountStage } from "./layers/stage";
import { mountNativeShell } from "./native-shell.js";
import { updateCoverTheme, setCustomPalette } from "./generated-theme";
import { applyLike } from "./liked";
import { Maximize2, PictureInPicture2 } from "lucide";
import { iconButton,ICON_SIZE } from "./icons";

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

let latestPlayback: PlaybackSnapshot | null = null;
let hiddenTrackId: string | null = null;
function showPlayback(snapshot: PlaybackSnapshot): void {
  latestPlayback = snapshot;
  if (!isRenderingActive()) {
    const track = snapshot.queue[snapshot.index] ?? null;
    if (track?.id !== hiddenTrackId) { hiddenTrackId = track?.id ?? null; lyricsLayer.setTrack(track); }
    syncMediaSession(snapshot);
    return;
  }
  const track = snapshot.index >= 0 ? (snapshot.queue[snapshot.index] ?? null) : null;
  if (track) updateCoverTheme(track.id, track.cover, track.title);
  playingNow = snapshot.status === "playing";
  document.documentElement.dataset.status = snapshot.status;
  stageLayer.setScene({ level: Number.parseFloat(document.documentElement.style.getPropertyValue("--tide-stage")) || 0, motion: motionAmount, playing: playingNow });
  chromeLayer.setPlayback(snapshot);
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
const nativeShell = mountNativeShell(document.querySelector<HTMLElement>("#app")!);
const stopPlayer = mountPlayer();
const stopCloseMenu = mountCloseMenu();

const bus = new EventBus<PlaybackEvents>();
bus.on("track-change", (payload) => {
  const track = payload.snapshot.queue[payload.index] ?? null;
  lyricsLayer.setTrack(track);
});


let stopClock = (): void => undefined;
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
  stopClock();
  document.documentElement.style.setProperty("--tide-phase", "0.5");
}

function installFace(family: string, dataUrl: string): void {
  const id = "tide-font-face";
  document.getElementById(id)?.remove();
  const style = document.createElement("style");
  style.id = id;
  const safe = family.replaceAll("\"", "");
  style.textContent = `@font-face { font-family: "${safe}"; src: url("${dataUrl}"); font-display: swap; }`;
  document.head.append(style);
  document.documentElement.style.setProperty("--tide-font-custom", `"${safe}"`);
}

function commitAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.dataset.theme = isThemeId(appearance.theme) ? appearance.theme : "tide";
  root.dataset.shell = appearance.shell === "lattice" ? "lattice" : "lens";
  root.dataset.colorMode = appearance.shell === "lattice" ? appearance.latticeMode ?? "dark" : appearance.lensMode ?? (appearance.theme === "dusk" ? "dark" : "light");
  setCustomPalette(appearance.customPalette);
  root.dataset.preset = appearance.preset;
  root.dataset.performance = appearance.performance;
  root.dataset.background = appearance.background;
  root.dataset.font = appearance.fontPreset;
  root.style.setProperty("--tide-font-custom", appearance.fontFamily ? `"${appearance.fontFamily.replaceAll("\"", "")}"` : "sans-serif");
  if (appearance.fontPreset === "custom") {
    void window.tide.fontFace().then((face) => {
      if (!face) return;
      installFace(face.family, face.dataUrl);
    });
  }
  chromeRoot.hidden = !appearance.chromeVisible;
  setStageMotion(appearance.stageLevel, appearance.motion);
  stageLayer.setLattice(appearance.lattice);
  chromeLayer.setLattice(appearance.lattice);
  library.setLattice(appearance.lattice);
  library.setAppearance(appearance);
  nativeShell.sync(appearance);
}

let desiredAppearance: Appearance | null = null;
let appearanceGeneration=0, themeTransition: ViewTransition | null=null;
function applyAppearance(appearance: Appearance): Promise<void> {
 const prior=desiredAppearance;desiredAppearance=appearance;const generation=++appearanceGeneration;
 const mode=(a:Appearance)=>a.shell==="lattice"?a.latticeMode??"dark":a.lensMode??(a.theme==="dusk"?"dark":"light");
 const changed=prior&&(prior.shell!==appearance.shell||mode(prior)!==mode(appearance));
 if(changed){themeTransition?.skipTransition();themeTransition=null;setThemeTransitionActive(false);}
 if(changed&&appearance.performance!=="smooth"&&appearance.motion>0&&isRenderingActive()&&!matchMedia("(prefers-reduced-motion: reduce)").matches&&typeof document.startViewTransition==="function") {
  document.documentElement.style.setProperty("--theme-duration",appearance.performance==="vivid"?"1400ms":"1000ms");
  document.documentElement.style.setProperty("--theme-radius",`${Math.ceil(Math.hypot(innerWidth,innerHeight)+12)}px`);
  const transition=document.startViewTransition(async()=>{if(generation===appearanceGeneration)commitAppearance(appearance);await new Promise(resolve=>setTimeout(resolve,100));if(themeTransition===transition)setThemeTransitionActive(true);});
  themeTransition=transition;
  void transition.finished.finally(()=>{if(themeTransition===transition){themeTransition=null;setThemeTransitionActive(false);}}).catch(()=>{});
  return themeTransition.updateCallbackDone.catch(()=>{});
 }
 commitAppearance(appearance);return Promise.resolve();
}
installModuleMotion();
const fullscreenButton=iconButton("进入全屏","Maximize2",Maximize2,ICON_SIZE.row);fullscreenButton.classList.add("fullscreen-toggle");document.body.append(fullscreenButton);
const miniButton=iconButton("呼出小窗播放器","PictureInPicture2",PictureInPicture2,ICON_SIZE.row);miniButton.classList.add("mini-toggle");document.body.append(miniButton);miniButton.onclick=()=>void window.tide.setMiniPlayer({open:true});
fullscreenButton.onclick=()=>void window.tide.setFullscreen();
window.tide.onFullscreen(value=>{document.documentElement.dataset.fullscreen=String(value);fullscreenButton.setAttribute("aria-label",value?"退出全屏":"进入全屏");fullscreenButton.title=value?"退出全屏（Esc）":"进入全屏（F11）";});

applyAppearance({
  chromeVisible: true,
  stageLevel: 1,
  theme: "tide",
  motion: 1,
  lattice: false,
  shell: "lens",
  preset: "flow",
  performance: "balanced",
  background: "paper",
  fontPreset: "system",
  fontFamily: "",
});
void window.tide.backdropUrl().then((url) => {
  if (url) document.documentElement.style.setProperty("--tide-image", `url("${url}")`);
});
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

window.tide.onRenderActive?.(setRenderingActive);
window.tide.onLikeState?.(value=>applyLike(value.id,value.liked));
document.addEventListener("visibilitychange", () => { if (isRenderingActive() && latestPlayback) showPlayback(latestPlayback); });
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
  stopCloseMenu();
  nativeShell.destroy();
  stopClock();
  stageLayer.destroy();
  lyricsLayer.destroy();
  chromeLayer.destroy();
  library.destroy();
  stopPlayer();
});
