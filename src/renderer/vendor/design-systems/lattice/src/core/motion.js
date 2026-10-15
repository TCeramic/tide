// Motion primitives shared by every element: a driveable clock, springs, and small math.

export const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Seeded PRNG (mulberry32) so formations and videos are reproducible. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Critically-tunable spring. Presets mirror the physical materials of the world. */
export const SPRINGS = {
  seal: { k: 520, c: 30 },   // carved stone: quick, firm, no wobble
  ring: { k: 110, c: 17 },   // bronze ring: heavy, one soft overshoot
  paper: { k: 80, c: 10 },   // talisman paper: light, flutters
  eye: { k: 900, c: 55 },    // cursor: tight follow
};

export class Spring {
  constructor(value = 0, preset = SPRINGS.ring) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.k = preset.k;
    this.c = preset.c;
  }
  set(v) { this.value = this.target = v; this.velocity = 0; return this; }
  step(dt) {
    // semi-implicit Euler, substepped for stability at low frame rates
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -this.k * (this.value - this.target) - this.c * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  get settled() { return Math.abs(this.value - this.target) < 1e-4 && Math.abs(this.velocity) < 1e-4; }
}

/**
 * One clock drives the whole page. In record mode (?record) time only advances
 * through clock.renderAt(t), so the Video Gen toolkit can capture frames deterministically.
 */
class Clock {
  constructor() {
    this.subs = new Set();
    this.time = 0;
    this.manual = typeof location !== "undefined" && new URLSearchParams(location.search).has("record");
    this._last = 0;
    this._raf = 0;
    this._tick = this._tick.bind(this);
    if (!this.manual && typeof requestAnimationFrame === "function") this._raf = requestAnimationFrame(this._tick);
  }
  add(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  _emit(dt) { for (const fn of this.subs) fn(dt, this.time); }
  _tick(now) {
    const dt = this._last ? Math.min(0.05, (now - this._last) / 1000) : 1 / 60;
    this._last = now;
    this.time += dt;
    this._emit(dt);
    this._raf = requestAnimationFrame(this._tick);
  }
  /** Advance to absolute time t (seconds) in fixed 1/60 steps. */
  renderAt(t) {
    while (this.time < t - 1e-6) {
      const dt = Math.min(1 / 60, t - this.time);
      this.time += dt;
      this._emit(dt);
    }
  }
}
export const clock = new Clock();

/** Tween helper on the shared clock; resolves when done. */
export function tween(duration, onUpdate, ease = easeOutExpo) {
  return new Promise((resolve) => {
    if (duration <= 0 || reducedMotion()) { onUpdate(1); resolve(); return; }
    let t = 0;
    const off = clock.add((dt) => {
      t = Math.min(1, t + dt / duration);
      onUpdate(ease(t));
      if (t >= 1) { off(); resolve(); }
    });
  });
}

export const wait = (s) => tween(s, () => {}, (t) => t);
