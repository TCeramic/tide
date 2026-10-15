// 集 Sets — every shape is a target for each particle: xyz position + w "class"
// (0 hidden · 0.35 grid dot · 1 lit). The lattice is the page at rest; other sets are maps from it.
import { rng } from "../core/motion.js";

/* Classic 5×7 dot-matrix glyphs (rows top→bottom, 5 bits each). */
const F = {
  A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110", D: "11100 10010 10001 10001 10001 10010 11100",
  E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110", J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 10001 11001 10101 10011 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110", P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110", V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 10101 01010", X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 10001 01010 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
  0: "01110 10001 10011 10101 11001 10001 01110", 1: "00100 01100 00100 00100 00100 00100 01110",
  2: "01110 10001 00001 00010 00100 01000 11111", 3: "11111 00010 00100 00010 00001 10001 01110",
  4: "00010 00110 01010 10010 11111 00010 00010", 5: "11111 10000 11110 00001 00001 10001 01110",
  6: "00110 01000 10000 11110 10001 10001 01110", 7: "11111 00001 00010 00100 01000 01000 01000",
  8: "01110 10001 10001 01110 10001 10001 01110", 9: "01110 10001 10001 01111 00001 00010 01100",
  " ": "00000 00000 00000 00000 00000 00000 00000", ".": "00000 00000 00000 00000 00000 01100 01100",
  "-": "00000 00000 00000 11111 00000 00000 00000", "·": "00000 00000 00000 00100 00000 00000 00000",
};

/** Rasterize a line of text in the 5×7 matrix. Returns {w, h, on(x,y)}. */
export function matrixText(str, scale = 1) {
  const chars = [...str.toUpperCase()];
  const cols = chars.length * 6 - 1;
  const bits = [];
  chars.forEach((ch, ci) => {
    const rows = (F[ch] || F[" "]).split(" ");
    rows.forEach((row, y) => [...row].forEach((b, x) => { if (b === "1") bits.push([ci * 6 + x, y]); }));
  });
  const set = new Set();
  for (const [x, y] of bits) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) set.add(`${x * scale + dx},${y * scale + dy}`);
  return { w: cols * scale, h: 7 * scale, on: (x, y) => set.has(`${x},${y}`), count: set.size };
}

/** Rasterize CJK (or any) text with a real font at lattice resolution. */
export function rasterText(str, rows = 16, font = "700 16px 'Noto Sans SC', sans-serif") {
  const cv = document.createElement("canvas");
  const g = cv.getContext("2d");
  g.font = font.replace(/\d+px/, `${rows}px`);
  const w = Math.ceil(g.measureText(str).width) + 2;
  cv.width = w; cv.height = rows + 2;
  g.font = font.replace(/\d+px/, `${rows}px`);
  g.textBaseline = "top";
  g.fillStyle = "#fff";
  g.fillText(str, 1, 1);
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  const on = (x, y) => x >= 0 && y >= 0 && x < cv.width && y < cv.height && d[(y * cv.width + x) * 4 + 3] > 110;
  return { w: cv.width, h: cv.height, on };
}

/**
 * The page lattice: a grid of sites filling the hero plane (z = 0).
 * Particle i < sites is bound to site i; visible sites form the dot grid.
 */
export class Lattice {
  constructor(N, width, height, cols) {
    this.N = N;
    this.cols = cols;
    this.pitch = width / cols;
    this.rows = Math.floor(height / this.pitch);
    this.sites = this.cols * this.rows;
    this.x0 = -((this.cols - 1) * this.pitch) / 2;
    this.y0 = ((this.rows - 1) * this.pitch) / 2;
    this.gridStep = 2; // every 2nd site is a visible grid dot
  }
  site(i) { const c = i % this.cols, r = Math.floor(i / this.cols); return [this.x0 + c * this.pitch, this.y0 - r * this.pitch, c, r]; }
  gridVisible(c, r) { return c % this.gridStep === 0 && r % this.gridStep === 0; }

  /** Rest state: grid dots visible, the rest stacked invisibly on random sites. */
  rest() {
    const d = new Float32Array(this.N * 4);
    const rand = rng(3);
    for (let i = 0; i < this.N; i++) {
      const s = i < this.sites ? i : Math.floor(rand() * this.sites);
      const [x, y, c, r] = this.site(s);
      d.set([x, y, 0, i < this.sites && this.gridVisible(c, r) ? 0.35 : 0], i * 4);
    }
    return d;
  }

  /**
   * Light up sites from a bitmap (text) placed at (col, row). Each lit site becomes a small
   * living swarm fed by the spare particles; grid dots stay where they are.
   */
  lit(bitmaps, { lift = 0.14, swarm = 0.42, seed = 5, perSite = 22 } = {}) {
    const d = this.rest();
    const rand = rng(seed);
    const litSites = [];
    for (const { map, col, row } of bitmaps)
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++)
        if (map.on(x, y)) { const c = col + x, r = row + y; if (c >= 0 && c < this.cols && r >= 0 && r < this.rows) litSites.push(r * this.cols + c); }
    if (!litSites.length) return d;
    const litSet = new Set(litSites);
    // spare particles: everything not needed as a visible grid dot on an unlit site
    const spare = [];
    for (let i = 0; i < this.N; i++) {
      if (i < this.sites) {
        const [, , c, r] = this.site(i);
        if (this.gridVisible(c, r) && !litSet.has(i)) continue;
      }
      spare.push(i);
    }
    const cap = litSites.length * perSite;
    spare.forEach((i, k) => {
      if (k >= cap) return; // the rest stay hidden on the page, ready for the next set
      const s = litSites[k % litSites.length];
      const [x, y] = this.site(s);
      // points inside a small sphere around the site, denser at the centre
      const u = rand(), v = rand(), w = Math.cbrt(rand());
      const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1);
      const rr = w * swarm * this.pitch;
      d.set([x + Math.sin(ph) * Math.cos(th) * rr, y + Math.sin(ph) * Math.sin(th) * rr, lift + Math.cos(ph) * rr, 1], i * 4);
    });
    return d;
  }

  /** Send every non-grid particle into a 3D shape; the grid stays on the page. */
  shape(points, { z = 0 } = {}) {
    const d = this.rest();
    let k = 0;
    const n = points.length / 3;
    for (let i = 0; i < this.N; i++) {
      if (i < this.sites) { const [, , c, r] = this.site(i); if (this.gridVisible(c, r)) continue; }
      const j = k++ % n;
      d.set([points[j * 3], points[j * 3 + 1], points[j * 3 + 2] + z, 1], i * 4);
    }
    return d;
  }
}

/* ---------- 3D point sets (centred at origin, radius ≈ 1) ---------- */

function normalise(arr, radius) {
  let cx = 0, cy = 0, cz = 0; const n = arr.length / 3;
  for (let i = 0; i < n; i++) { cx += arr[i * 3]; cy += arr[i * 3 + 1]; cz += arr[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  let m = 0;
  for (let i = 0; i < n; i++) { arr[i * 3] -= cx; arr[i * 3 + 1] -= cy; arr[i * 3 + 2] -= cz; m = Math.max(m, Math.hypot(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2])); }
  for (let i = 0; i < arr.length; i++) arr[i] *= radius / m;
  return arr;
}

/** Lorenz attractor, σ = 10, ρ = 28, β = 8/3, integrated with RK4 and sampled evenly in time. */
export function lorenz(n, radius = 1) {
  const out = new Float32Array(n * 3);
  let x = 0.1, y = 0, z = 0;
  const s = 10, r = 28, b = 8 / 3, h = 0.004;
  const f = (x, y, z) => [s * (y - x), x * (r - z) - y, x * y - b * z];
  for (let i = 0; i < 3000; i++) step();
  function step() {
    const k1 = f(x, y, z);
    const k2 = f(x + (h / 2) * k1[0], y + (h / 2) * k1[1], z + (h / 2) * k1[2]);
    const k3 = f(x + (h / 2) * k2[0], y + (h / 2) * k2[1], z + (h / 2) * k2[2]);
    const k4 = f(x + h * k3[0], y + h * k3[1], z + h * k3[2]);
    x += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    y += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    z += (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
  }
  for (let i = 0; i < n; i++) { step(); step(); out.set([x, z - 25, y], i * 3); }
  return normalise(out, radius);
}

/** (p, q) torus knot drawn as a thick tube of points. */
export function torusKnot(n, p = 2, q = 3, radius = 1, seed = 9) {
  const out = new Float32Array(n * 3);
  const rand = rng(seed);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = 2 + Math.cos(q * t);
    const c = [r * Math.cos(p * t), r * Math.sin(p * t), -Math.sin(q * t)];
    const a = rand() * Math.PI * 2, rr = 0.28 * Math.sqrt(rand());
    out.set([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr * 0.8, c[2] + Math.sin(a) * rr], i * 3);
  }
  return normalise(out, radius);
}

/** Face-centred cubic crystal: 7³ unit cells, atoms as small clouds. */
export function crystal(n, radius = 1, seed = 4) {
  const rand = rng(seed);
  const sites = [];
  const m = 5;
  for (let a = 0; a <= m; a++) for (let b = 0; b <= m; b++) for (let c = 0; c <= m; c++) {
    sites.push([a, b, c]);
    if (a < m && b < m) sites.push([a + 0.5, b + 0.5, c]);
    if (a < m && c < m) sites.push([a + 0.5, b, c + 0.5]);
    if (b < m && c < m) sites.push([a, b + 0.5, c + 0.5]);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = sites[i % sites.length];
    const rr = 0.07 * Math.cbrt(rand()), th = rand() * 6.283, ph = Math.acos(2 * rand() - 1);
    out.set([s[0] + rr * Math.sin(ph) * Math.cos(th), s[1] + rr * Math.sin(ph) * Math.sin(th), s[2] + rr * Math.cos(ph)], i * 3);
  }
  return normalise(out, radius);
}

/** Figure-8 immersion of the Klein bottle. */
export function klein(n, radius = 1, seed = 2) {
  const rand = rng(seed);
  const out = new Float32Array(n * 3);
  const R = 2.2;
  for (let i = 0; i < n; i++) {
    const u = rand() * Math.PI * 2, v = rand() * Math.PI * 2;
    const c = Math.cos(u / 2), s = Math.sin(u / 2);
    const w = R + c * Math.sin(v) - s * Math.sin(2 * v);
    out.set([w * Math.cos(u), w * Math.sin(u), s * Math.sin(v) + c * Math.sin(2 * v)], i * 3);
  }
  return normalise(out, radius);
}

/** Fibonacci sphere: the most even set of n points on S². */
export function sphere(n, radius = 1) {
  const out = new Float32Array(n * 3);
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), t = g * i;
    out.set([Math.cos(t) * r * radius, y * radius, Math.sin(t) * r * radius], i * 3);
  }
  return out;
}
