// 字 Dot text — 5×7 matrix lettering drawn as dots that reflow between strings: dots the new
// text still needs stay and slide, the rest fly off, missing ones arrive. Also used for counters.
// Also: a Lorenz loader, the "thinking" state of the system.
import { clock, reducedMotion } from "../core/motion.js";
import { matrixText } from "../gl/sets.js";
import { Dots, mountCanvas, css, animateWhileVisible } from "./dotkit.js";

export function mountDotText(el, { pitch = 4, color = "--hot" } = {}) {
  const text = el.textContent.trim();
  el.setAttribute("aria-label", text);
  el.textContent = "";
  el.classList.add("lx-dottext");
  const { g, size } = mountCanvas(el);
  const MAX = 900;
  const dots = new Dots(MAX);
  dots.k = 120; dots.damp = 11;
  let used = 0, current = "";
  const layout = (str) => {
    const m = matrixText(str, 1);
    el.style.width = `${m.w * pitch}px`;
    el.style.height = `${7 * pitch}px`;
    const pts = [];
    for (let y = 0; y < 7; y++) for (let x = 0; x < m.w; x++) if (m.on(x, y)) pts.push([(x + 0.5) * pitch, (y + 0.5) * pitch]);
    // reuse nearest old dots so shared strokes slide instead of re-spawning
    const n = Math.min(MAX, pts.length);
    for (let i = 0; i < n; i++) dots.home(i, pts[i][0], pts[i][1], 1);
    for (let i = n; i < Math.max(used, n); i++) { dots.home(i, dots.x[i] + (Math.random() - 0.5) * 40, dots.y[i] - 10 - Math.random() * 20, 0); }
    for (let i = used; i < n; i++) dots.place(i, pts[i][0] + (Math.random() - 0.5) * 30, pts[i][1] + (Math.random() - 0.5) * 30);
    used = n;
    dots.stagger(0.25);
  };
  const api = {
    set(str) {
      str = String(str);
      if (str === current) return;
      current = str;
      el.setAttribute("aria-label", str);
      layout(str);
      if (reducedMotion()) dots.snap();
    },
  };
  api.set(text);
  if (reducedMotion()) dots.snap();
  animateWhileVisible(el, (dt) => {
    dots.step(dt);
    g.clearRect(0, 0, size.w, size.h);
    dots.draw(g, { ink: css(color) || "#ff5a1f", hot: css(color), r: pitch * 0.36 });
  });
  el._dottext = api;
  return api;
}

/** Lorenz loader: one trajectory, drawn as a fading trail of points, slowly turning. */
export function mountLoader(el, { n = 700 } = {}) {
  el.setAttribute("role", "status");
  if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", "Working");
  const { g, size } = mountCanvas(el);
  const hist = new Float32Array(n * 3);
  let x = 0.1, y = 0, z = 0, head = 0, filled = 0;
  const step = (h) => { const dx = 10 * (y - x), dy = x * (28 - z) - y, dz = x * y - (8 / 3) * z; x += dx * h; y += dy * h; z += dz * h; };
  for (let i = 0; i < 2000; i++) step(0.005);
  animateWhileVisible(el, (dt, t) => {
    const steps = reducedMotion() ? 0 : 6;
    for (let s = 0; s < steps; s++) { step(0.004); hist.set([x, y, z], head * 3); head = (head + 1) % n; filled = Math.min(n, filled + 1); }
    const a = t * 0.4, ca = Math.cos(a), sa = Math.sin(a);
    const sc = Math.min(size.w, size.h) / 58;
    g.clearRect(0, 0, size.w, size.h);
    const ink = css("--ink"), hot = css("--hot");
    for (let k = 0; k < filled; k++) {
      const i = (head - 1 - k + n) % n;
      const px = hist[i * 3], py = hist[i * 3 + 1], pz = hist[i * 3 + 2] - 25;
      const rx = px * ca - py * sa;
      g.globalAlpha = (1 - k / filled) * 0.9;
      g.fillStyle = k < 12 ? hot : ink;
      g.fillRect(size.w / 2 + rx * sc - 0.8, size.h / 2 - pz * sc - 0.8, 1.6, 1.6);
    }
    g.globalAlpha = 1;
  });
}
