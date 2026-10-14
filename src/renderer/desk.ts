import type { DeskCue } from "../shared/contract";

const stack = document.querySelector<HTMLElement>("#stack");
const prev = document.querySelector<HTMLElement>("#prev");
const current = document.querySelector<HTMLElement>("#current");
const trans = document.querySelector<HTMLElement>("#trans");
const next = document.querySelector<HTMLElement>("#next");

if (!stack || !prev || !current || !trans || !next) {
  throw new Error("desktop lyric overlay is missing a node");
}

const root = document.documentElement;
const stackEl = stack;
const prevEl = prev;
const currentEl = current;
const transEl = trans;
const nextEl = next;

function paint(cue: DeskCue): void {
  root.style.setProperty("--desk-size", `${cue.fontSize}px`);
  root.style.setProperty("--desk-color", cue.color);
  root.style.setProperty("--desk-opacity", String(cue.opacity));
  const line = cue.empty ? cue.title : cue.current;
  if (currentEl.textContent !== line) {
    currentEl.textContent = line;
    currentEl.classList.remove("tick");
    void currentEl.offsetWidth;
    if (line.length > 0) currentEl.classList.add("tick");
  }
  prevEl.textContent = cue.empty ? "" : cue.previous;
  nextEl.textContent = cue.empty ? "" : cue.next;
  const translation = cue.empty ? "" : cue.translation;
  transEl.hidden = translation.length === 0;
  transEl.textContent = translation;
  stackEl.hidden = line.length === 0 && translation.length === 0 && cue.previous.length === 0;
}

window.tide.onDeskCue(paint);
