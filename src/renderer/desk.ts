import { mountDeskContext } from "./desk-context";
import type { DeskCue } from "../shared/contract";

const unlockTarget=new URLSearchParams(location.search).get("unlock");
if(unlockTarget){document.documentElement.dataset.unlock="true";const b=document.createElement("button");b.className="unlock-handle";b.textContent="解锁";b.setAttribute("aria-label",unlockTarget==="mini"?"解锁小窗播放器":"解锁桌面歌词");b.onclick=()=>void(unlockTarget==="mini"?window.tide.setMiniPlayer({locked:false}):window.tide.setDeskLyrics({locked:false}));document.body.replaceChildren(b);}
else if(new URLSearchParams(location.search).get("context")==="true") mountDeskContext(); else mountOverlay();
function mountOverlay(): void {
const nextEl = document.querySelector<HTMLElement>("#next")!;
window.addEventListener("contextmenu",event=>{event.preventDefault();void window.tide.openDeskMenu();});
const stack = document.querySelector<HTMLElement>("#stack");
const current = document.querySelector<HTMLElement>("#current");
const trans = document.querySelector<HTMLElement>("#trans");
const wave = document.querySelector<HTMLCanvasElement>("#wave");

if (!stack || !current || !trans || !wave) {
  throw new Error("desktop lyric overlay is missing a node");
}

const root = document.documentElement;
const stackEl = stack;
const currentEl = current;
const transEl = trans;
const waveEl = wave;
let waveFrame = 0;
let easeFrame = 0;
let shown = "";
let shownProgress = 1;
let targetProgress = 1;
let entrance: Animation | null = null;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const scroller = document.querySelector<HTMLElement>("#scroller")!;
let overflow = 0;
function measureLine(): void {
  overflow = root.dataset.orient === "vertical" ? Math.max(0, currentEl.offsetHeight - viewport.clientHeight) : Math.max(0, currentEl.offsetWidth - viewport.clientWidth);
  scroller.style.setProperty("--desk-overflow", `${overflow}px`);
}
new ResizeObserver(measureLine).observe(viewport);
window.tide.getDeskLyrics().then(settings => root.dataset.locked = String(settings.locked));
window.tide.onDeskState(settings => root.dataset.locked = String(settings.locked));
document.querySelector("#desk-lock")?.addEventListener("click", () => void window.tide.setDeskLyrics({ locked: true }));
document.querySelector("#desk-close")?.addEventListener("click", () => void window.tide.setDeskLyrics({ open: false }));

const ink = document.createElement("span");
ink.className = "ink";
const mask = document.createElement("span");
mask.className = "mask";
const sweep = document.createElement("span");
sweep.className = "sweep";
sweep.setAttribute("aria-hidden", "true");
mask.append(sweep);
currentEl.replaceChildren(ink, mask);

function writeSweep(value: number): void {
  const amount = Math.min(1, Math.max(0, value));
  const vertical = root.dataset.orient === "vertical";
  scroller.style.transform = `translate${vertical ? "Y" : "X"}(${-overflow * amount}px)`;
  const axis = vertical ? "Y" : "X";
  if (amount <= 0.001) {
    mask.style.opacity = "0";
    return;
  }
  const scale = amount >= 0.999 ? 1 : amount;
  mask.style.opacity = "1";
  mask.style.transform = `scale${axis}(${scale})`;
  sweep.style.transform = `scale${axis}(${scale === 1 ? 1 : 1 / scale})`;
}

function easeSweep(): void {
  easeFrame = 0;
  const delta = targetProgress - shownProgress;
  if (Math.abs(delta) < 0.004) {
    shownProgress = targetProgress;
    writeSweep(shownProgress);
    return;
  }
  shownProgress += delta * 0.42;
  writeSweep(shownProgress);
  easeFrame = requestAnimationFrame(easeSweep);
}

function paint(cue: DeskCue): void {
  root.style.setProperty("--desk-color", cue.color);
  root.style.setProperty("--desk-highlight", cue.highlightColor);
  root.style.setProperty("--desk-font", ["serif", "sans-serif", "monospace"].includes(cue.fontFamily) ? cue.fontFamily : `${JSON.stringify(cue.fontFamily)},sans-serif`);
  root.style.setProperty("--desk-size", `${cue.fontSize}px`);
  root.style.setProperty("--desk-opacity", String(cue.opacity));
  root.style.setProperty("--glow", cue.farGlow ? String(cue.glow) : String(Math.min(cue.glow, 0.28)));
  root.style.setProperty("--glow-far", cue.farGlow ? String(cue.glow * 0.65) : "0");
  root.style.setProperty("--feather", "6%");
  root.style.setProperty("--desk-backdrop", String(cue.backdrop ?? 0));
  const level = cue.motion ? (cue.motionLevel ?? 1) : 0;
  root.style.setProperty("--motion-shift", `${(8 * level).toFixed(1)}px`);
  root.style.setProperty("--motion-blur", `${(10 * level).toFixed(1)}px`);
  root.dataset.metadata=String(cue.metadata);
  root.dataset.orient = cue.orientation === "vertical" ? "vertical" : "horizontal";
  const nextProgress = cue.highlightFollow ? Math.min(1, Math.max(0, cue.progress)) : 0;
  const jumped = Math.abs(nextProgress - shownProgress) > 0.28 || !cue.highlightFollow || !cue.playing;
  targetProgress = nextProgress;
  if (jumped) {
    if (easeFrame) cancelAnimationFrame(easeFrame);
    easeFrame = 0;
    shownProgress = nextProgress;
    writeSweep(shownProgress);
  } else if (!easeFrame) {
    easeFrame = requestAnimationFrame(easeSweep);
  }
  currentEl.dataset.sweep = cue.wordLevel ? "word" : "line";
  currentEl.dataset.far = cue.farGlow ? "true" : "false";
  currentEl.classList.toggle("is-paused", !cue.playing);
  currentEl.classList.toggle("is-still", !cue.motion);
  const line = cue.empty ? "" : cue.text;
  if (ink.textContent !== line) {
    ink.textContent = line;
    sweep.textContent = line;
    entrance?.cancel(); entrance = null;
    if (cue.motion && line.length > 0 && shown !== line && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      entrance = currentEl.animate([
        { opacity: 0, transform: `translate3d(0,${8 * level}px,-120px) rotateX(24deg) rotateY(-18deg) scale(.78)`, filter: `blur(${10 * level}px)` },
        { opacity: cue.opacity, transform: "none", filter: "blur(0)" },
      ], { duration: 820, easing: "cubic-bezier(.16,.84,.32,1.02)" });
    }
    shown = line;
    requestAnimationFrame(() => { measureLine(); writeSweep(shownProgress); });
  }
  scroller.classList.toggle("is-scrolling", !cue.highlightFollow && cue.motion && cue.playing && overflow > 0);
  const next = cue.lineMode === "double" && !cue.metadata ? cue.next : "";
  nextEl.hidden=!next; if(nextEl.textContent!==next)nextEl.textContent=next;
  const translation = (cue.metadata || cue.pair) && !cue.empty ? cue.translation : "";
  transEl.hidden = translation.length === 0;
  if(transEl.textContent!==translation)transEl.textContent = translation;
  stackEl.hidden = line.length === 0 && translation.length === 0;
  paintWave(cue.wave && line.length > 0, cue.playing && cue.motion);
}

function paintWave(on: boolean, moving: boolean): void {
  waveEl.hidden = !on;
  if (waveFrame !== 0) cancelAnimationFrame(waveFrame);
  waveFrame = 0;
  if (!on) return;
  const context = waveEl.getContext("2d");
  if (!context) return;
  const draw = (now: number) => {
    const width = waveEl.clientWidth;
    const height = waveEl.clientHeight;
    if (width < 2 || height < 2) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    waveEl.width = Math.floor(width * ratio);
    waveEl.height = Math.floor(height * ratio);
    context.clearRect(0, 0, waveEl.width, waveEl.height);
    context.strokeStyle = "rgba(186, 214, 255, 0.45)";
    context.lineWidth = ratio;
    context.beginPath();
    const phase = moving ? now / 700 : 0;
    for (let x = 0; x <= waveEl.width; x += 4) {
      const y = waveEl.height * 0.55 + Math.sin(x / 28 + phase) * waveEl.height * 0.18;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
    if (moving) waveFrame = requestAnimationFrame(draw);
  };
  waveFrame = requestAnimationFrame(draw);
}

window.tide.onDeskCue(paint);

}
