// Controls in the point grammar. Each keeps its native semantics (buttons with roles, a real range
// input, aria progress) and draws its state as a set of dots that maps to the next state.
import { clock, reducedMotion } from "../core/motion.js";
import { sound } from "../core/sound.js";
import { Dots, mountCanvas, css, animateWhileVisible } from "./dotkit.js";

const colors = () => ({ ink: css("--ink") || "#ece7da", hot: css("--hot") || "#ff5a1f", dim: css("--text-dim") || "#9d988c" });

/* ---------- 标 Tabs: the indicator is a swarm that flows to the chosen tab ---------- */
export function mountTabs(list) {
  const tabs = [...list.querySelectorAll("[role=tab]")];
  list.style.position = "relative";
  const { g, size } = mountCanvas(list, { inset: 12 });
  const COLS = 14, ROWS = 2, N = COLS * ROWS;
  const dots = new Dots(N);
  dots.k = 90; dots.damp = 10;
  let sel = Math.max(0, tabs.findIndex((t) => t.getAttribute("aria-selected") === "true"));
  let transit = 0;
  const homes = () => {
    const lb = list.getBoundingClientRect(), tb = tabs[sel].getBoundingClientRect();
    const x0 = tb.left - lb.left + 12 + 6, w = tb.width - 12, y0 = tb.bottom - lb.top + 12 + 2;
    for (let i = 0; i < N; i++) { const c = i % COLS, r = Math.floor(i / COLS); dots.home(i, x0 + (c / (COLS - 1)) * w, y0 + r * 4, 1); }
  };
  const select = (i, focus) => {
    if (i === sel) return;
    const dir = i > sel ? 1 : -1;
    sel = (i + tabs.length) % tabs.length;
    tabs.forEach((t, k) => { t.setAttribute("aria-selected", String(k === sel)); t.tabIndex = k === sel ? 0 : -1; });
    homes();
    dots.stagger(0.22, (k) => dir * dots.x[k] * -1);
    transit = 0.5;
    if (focus) tabs[sel].focus();
    sound.whoosh(0.35, dir > 0); sound.pluck(sel, 0.12);
    list.dispatchEvent(new CustomEvent("tabs:change", { detail: { index: sel, value: tabs[sel].dataset.value }, bubbles: true }));
  };
  tabs.forEach((t, i) => {
    t.tabIndex = i === sel ? 0 : -1;
    t.addEventListener("click", () => select(i));
    t.addEventListener("keydown", (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (k) { e.preventDefault(); select(sel + k, true); }
    });
  });
  homes(); dots.snap();
  new ResizeObserver(() => { homes(); dots.snap(); }).observe(list);
  animateWhileVisible(list, (dt) => {
    transit = Math.max(0, transit - dt);
    dots.flow = transit > 0 ? 900 * transit : 0;
    dots.step(dt);
    const c = colors();
    g.clearRect(0, 0, size.w, size.h);
    dots.draw(g, { ink: c.hot, hot: c.hot, r: 1.3 });
  });
  return { select, get index() { return sel; } };
}

/* ---------- 相 Switch: off, the points float free as a gas over the whole track; on, they converge
   to the right end and lock into a crystal, each one flashing as it locks. Off again, the crystal melts outward. ---------- */
export function mountSwitch(btn) {
  const track = btn.querySelector(".lx-switch__track");
  const { g, size } = mountCanvas(track);
  const N = 19;
  const dots = new Dots(N);
  dots.k = 70; dots.damp = 10;
  const hex = [];
  for (let r = -2; r <= 2; r++) for (let q = -2; q <= 2; q++) { const s = -q - r; if (Math.abs(s) <= 2) hex.push([q + r / 2, r * 0.866]); }
  const anchor = new Float32Array(N * 2); // where each point floats while it is gas
  const flash = new Float32Array(N);
  const locked = new Uint8Array(N);
  const isOn = () => btn.getAttribute("aria-checked") === "true";
  const spread = () => {
    const pad = size.h * 0.2;
    for (let i = 0; i < N; i++) {
      // stratified across the width so the gas really fills the track, jittered so it never looks gridded
      anchor[i * 2] = pad + ((i + 0.2 + dots.seed[i] * 0.6) / N) * (size.w - pad * 2);
      anchor[i * 2 + 1] = pad + ((i * 7) % N / N) * (size.h - pad * 2);
    }
  };
  const crystal = (i) => { const [x, y] = hex[i % hex.length], p = size.h * 0.13; return [size.w - size.h / 2 + x * p, size.h / 2 + y * p]; };
  const apply = (animate) => {
    const on = isOn();
    if (on) {
      for (let i = 0; i < N; i++) { const [x, y] = crystal(i); dots.home(i, x, y, 1); }
      dots.k = 70; dots.damp = 10;
      if (animate) dots.stagger(0.3, (i) => -dots.x[i]); // the nearest (rightmost) arrive first
    } else {
      locked.fill(0);
      dots.k = 16; dots.damp = 5; // soft springs: the gas drifts rather than snaps
      if (animate) for (let i = 0; i < N; i++) { dots.vx[i] = (anchor[i * 2] - dots.x[i]) * 2.2; dots.vy[i] = (dots.seed[i] - 0.5) * 60; } // melt outward
    }
  };
  btn.setAttribute("role", "switch");
  if (!btn.hasAttribute("aria-checked")) btn.setAttribute("aria-checked", "false");
  const set = (on, { quiet = false } = {}) => {
    if (on === isOn()) return;
    btn.setAttribute("aria-checked", String(on));
    apply(true);
    if (!quiet) on ? sound.pluck(7, 0.14) : sound.tick(0.8);
    btn.dispatchEvent(new CustomEvent("switch:change", { detail: on, bubbles: true }));
  };
  btn.addEventListener("click", () => { btn._touched = true; set(!isOn()); });
  new ResizeObserver(() => {
    spread();
    apply(false);
    for (let i = 0; i < N; i++) {
      if (isOn()) { const [x, y] = crystal(i); dots.place(i, x, y); locked[i] = 1; }
      else dots.place(i, anchor[i * 2], anchor[i * 2 + 1]);
    }
  }).observe(track);
  animateWhileVisible(btn, (dt, t) => {
    const on = isOn();
    if (!on) for (let i = 0; i < N; i++) {
      const s = dots.seed[i] * 6.283;
      // each gas point floats on its own slow Lissajous path around its anchor
      dots.home(i, anchor[i * 2] + Math.sin(t * (0.7 + dots.seed[i] * 0.6) + s) * size.h * 0.16, anchor[i * 2 + 1] + Math.cos(t * (0.9 + dots.seed[i] * 0.5) + s * 1.7) * size.h * 0.12, 0.6);
    }
    dots.step(dt);
    let just = 0;
    if (on) for (let i = 0; i < N; i++) if (!locked[i] && Math.hypot(dots.x[i] - dots.tx[i], dots.y[i] - dots.ty[i]) < 0.8) { locked[i] = 1; flash[i] = 1; just++; }
    if (just && locked.every((v) => v)) sound.tick(1.6, 0.1);
    const c = colors();
    g.clearRect(0, 0, size.w, size.h);
    const r = size.h * 0.07;
    for (let i = 0; i < N; i++) {
      flash[i] = Math.max(0, flash[i] - dt * 2.5);
      g.globalAlpha = Math.min(1, dots.a[i]);
      g.fillStyle = flash[i] > 0.3 ? c.ink : on ? c.hot : c.ink;
      g.beginPath(); g.arc(dots.x[i], dots.y[i], r * (1 + flash[i] * 0.9), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  });
  btn._switch = { set, get on() { return isOn(); } };
  return btn._switch;
}

/* ---------- 标尺 Slider: a row of dots; the thumb is a dense cluster that pushes its neighbours ---------- */
export function mountSlider(input) {
  const wrap = input.closest(".lx-slider");
  const { g, size } = mountCanvas(wrap);
  const out = wrap.querySelector("[data-out]");
  let N = 0, dots, thumb;
  const build = () => {
    N = Math.max(8, Math.floor(size.w / 9));
    dots = new Dots(N); dots.k = 120; dots.damp = 12;
    for (let i = 0; i < N; i++) dots.home(i, 6 + (i / (N - 1)) * (size.w - 12), size.h / 2, 1);
    dots.snap();
    thumb = new Dots(7); thumb.k = 260; thumb.damp = 18;
  };
  const val = () => (input.value - input.min) / (input.max - input.min || 1);
  new ResizeObserver(build).observe(wrap);
  build();
  let last = -1, dragging = false;
  input.addEventListener("pointerdown", () => (dragging = true));
  addEventListener("pointerup", () => (dragging = false));
  input.addEventListener("input", () => {
    const n = Math.round(val() * (N - 1));
    if (n !== last) { sound.tick(0.8 + val()); last = n; }
    if (out) out.textContent = input.value;
  });
  animateWhileVisible(wrap, (dt, t) => {
    const v = val(), x = 6 + v * (size.w - 12), y = size.h / 2;
    for (let i = 0; i < 7; i++) { const a = (i / 6) * Math.PI * 2 + t * (dragging ? 3 : 0.8); thumb.home(i, i === 6 ? x : x + Math.cos(a) * 5.5, i === 6 ? y : y + Math.sin(a) * 5.5, 1); }
    thumb.step(dt);
    for (let i = 0; i < N; i++) {
      const hx = 6 + (i / (N - 1)) * (size.w - 12);
      const d = hx - x, push = Math.abs(d) < 16 ? Math.sign(d || 1) * (16 - Math.abs(d)) * 0.35 : 0;
      dots.home(i, hx + push, y, hx <= x ? 1 : 0.35);
    }
    dots.step(dt);
    const c = colors();
    g.clearRect(0, 0, size.w, size.h);
    dots.draw(g, { ink: c.ink, hot: c.hot, r: 1.6, hotOf: (i) => (dots.tx[i] <= x ? 1 : 0) });
    thumb.draw(g, { ink: c.hot, hot: c.hot, r: 2.1 });
  });
  if (out) out.textContent = input.value;
}

/* ---------- 晶 Progress: unfinished work is a gas floating loosely around the bar. Each newly finished
   part is built from it: its points converge onto their lattice sites, lock with a flash, and stay fixed. ---------- */
export function mountProgress(el) {
  const { g, size } = mountCanvas(el);
  let dots, cols = 0, rows = 3, value = 0, target = parseFloat(el.dataset.value || "0"), indeterminate = el.hasAttribute("data-indeterminate");
  let locked, flash, anchor, solidPrev;
  const site = (i) => { const c = i % cols, r = Math.floor(i / cols); const pitch = size.w / cols, oy = (size.h - (rows - 1) * 5) / 2; return [(c + 0.5) * pitch, oy + r * 5, c / (cols - 1)]; };
  const build = () => {
    cols = Math.max(10, Math.floor(size.w / 7));
    dots = new Dots(cols * rows); dots.k = 14; dots.damp = 4.5;
    locked = new Uint8Array(dots.n); flash = new Float32Array(dots.n); solidPrev = new Uint8Array(dots.n);
    anchor = new Float32Array(dots.n * 2);
    for (let i = 0; i < dots.n; i++) {
      const [x, y] = site(i);
      // the gas cloud: each point hangs loosely near its own site, up to three columns away
      anchor[i * 2] = x + (dots.seed[i] - 0.5) * (size.w / cols) * 6;
      anchor[i * 2 + 1] = y + (Math.sin(i * 12.9898) * 0.5) * size.h * 0.6;
      dots.place(i, anchor[i * 2], anchor[i * 2 + 1]);
      dots.a[i] = dots.ta[i] = 0.34;
    }
  };
  new ResizeObserver(build).observe(el);
  build();
  el.setAttribute("role", "progressbar");
  el.setAttribute("aria-valuemin", "0"); el.setAttribute("aria-valuemax", "100");
  let done = false;
  const api = {
    set(v) { target = Math.max(0, Math.min(1, v)); indeterminate = false; el.setAttribute("aria-valuenow", String(Math.round(target * 100))); },
    indeterminate(on = true) { indeterminate = on; el.removeAttribute("aria-valuenow"); },
    get value() { return target; },
  };
  animateWhileVisible(el, (dt, t) => {
    value += (target - value) * Math.min(1, dt * 6);
    if (reducedMotion()) value = target;
    const sweep = indeterminate ? ((t * 0.45) % 1.4) - 0.2 : -1;
    let newly = 0;
    for (let i = 0; i < dots.n; i++) {
      const [x, y, fx] = site(i);
      const solid = indeterminate ? Math.abs(fx - sweep) < 0.12 : fx <= value + 1e-4;
      if (solid) {
        if (!solidPrev[i]) { solidPrev[i] = 1; dots.home(i, x, y, 1); dots.delay[i] = dots.seed[i] * 0.2; newly++; }
        if (!locked[i] && Math.hypot(dots.x[i] - x, dots.y[i] - y) < 0.8) { locked[i] = 1; flash[i] = 1; }
        if (locked[i]) dots.place(i, x, y); // fixed: a built site no longer moves
      } else {
        if (solidPrev[i]) { solidPrev[i] = 0; locked[i] = 0; dots.vx[i] = (dots.seed[i] - 0.5) * 50; dots.vy[i] = (Math.random() - 0.5) * 50; } // melts back into the gas
        const s = dots.seed[i] * 6.283;
        dots.home(i, anchor[i * 2] + Math.sin(t * (0.6 + dots.seed[i] * 0.7) + s) * 6, anchor[i * 2 + 1] + Math.cos(t * (0.8 + dots.seed[i] * 0.6) + s * 1.3) * 4, 0.34);
      }
    }
    // convergence uses a firmer spring than the floating gas
    dots.k = 14; dots.damp = 4.5;
    for (let i = 0; i < dots.n; i++) if (solidPrev[i] && !locked[i]) { dots.k = 60; dots.damp = 8; break; }
    if (newly && !indeterminate) sound.tick(1 + value, 0.1);
    const complete = !indeterminate && value > 0.995;
    if (complete && !done) { done = true; sound.chord(2); el.classList.add("is-complete"); for (let i = 0; i < dots.n; i++) flash[i] = Math.max(flash[i], 0.6); }
    if (!complete) { done = false; el.classList.remove("is-complete"); }
    dots.step(dt);
    const cl = colors();
    g.clearRect(0, 0, size.w, size.h);
    for (let i = 0; i < dots.n; i++) {
      flash[i] = Math.max(0, flash[i] - dt * 2.2);
      const solid = solidPrev[i];
      g.globalAlpha = Math.min(1, dots.a[i]);
      g.fillStyle = flash[i] > 0.35 ? cl.ink : solid ? cl.hot : cl.ink;
      const r = (solid ? 1.5 : 1.25) * (1 + flash[i] * 0.9);
      g.beginPath(); g.arc(dots.x[i], dots.y[i], r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  });
  api.set(target);
  el._progress = api;
  return api;
}
