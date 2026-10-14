import type { DeskCue } from "../shared/contract";

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
  root.style.setProperty("--desk-size", `${cue.fontSize}px`);
  root.style.setProperty("--desk-opacity", String(cue.opacity));
  root.style.setProperty("--glow", cue.farGlow ? String(cue.glow) : String(Math.min(cue.glow, 0.28)));
  root.style.setProperty("--glow-far", cue.farGlow ? String(cue.glow * 0.65) : "0");
  root.style.setProperty("--feather", "6%");
  root.style.setProperty("--desk-backdrop", String(cue.backdrop ?? 0));
  const level = cue.motion ? (cue.motionLevel ?? 1) : 0;
  root.style.setProperty("--motion-shift", `${(8 * level).toFixed(1)}px`);
  root.style.setProperty("--motion-blur", `${(10 * level).toFixed(1)}px`);
  root.dataset.orient = cue.orientation === "vertical" ? "vertical" : "horizontal";
  const nextProgress = cue.wordLevel ? Math.min(1, Math.max(0, cue.progress)) : 1;
  const jumped = Math.abs(nextProgress - shownProgress) > 0.28 || !cue.wordLevel || !cue.playing;
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
    currentEl.classList.remove("enter");
    if (cue.motion && line.length > 0 && shown !== line) currentEl.classList.add("enter");
    shown = line;
  }
  currentEl.classList.toggle("is-long", line.length > 18);
  const translation = cue.pair && !cue.empty ? cue.translation : "";
  transEl.hidden = translation.length === 0;
  transEl.textContent = translation;
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
