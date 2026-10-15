// 眼 Cursor — a point with a small set around it. Over anything you can act on, the set leaves the
// pointer and re-forms along that control's outline (the "meteors converge into the option" idea);
// pressing bursts it; holding on the field turns the ring hot as the points melt.
import { clock, reducedMotion } from "../core/motion.js";
import { Dots, css } from "./dotkit.js";

const TARGETS = "a[href],button:not([disabled]),[role=tab],[role=switch],[role=option],input,select,textarea,summary,[data-halo]";

function roundRectPoint(b, r, s) {
  // s ∈ [0,1) along the outline, clockwise from the top-left straight edge
  const w = b.w, h = b.h, rr = Math.min(r, w / 2, h / 2);
  const straightW = w - 2 * rr, straightH = h - 2 * rr, arc = (Math.PI / 2) * rr;
  const L = 2 * straightW + 2 * straightH + 4 * arc;
  let d = (((s % 1) + 1) % 1) * L;
  const seg = [
    [straightW, (u) => [b.x + rr + u, b.y]],
    [arc, (u) => { const a = -Math.PI / 2 + u / rr; return [b.x + w - rr + Math.cos(a) * rr, b.y + rr + Math.sin(a) * rr]; }],
    [straightH, (u) => [b.x + w, b.y + rr + u]],
    [arc, (u) => { const a = u / rr; return [b.x + w - rr + Math.cos(a) * rr, b.y + h - rr + Math.sin(a) * rr]; }],
    [straightW, (u) => [b.x + w - rr - u, b.y + h]],
    [arc, (u) => { const a = Math.PI / 2 + u / rr; return [b.x + rr + Math.cos(a) * rr, b.y + h - rr + Math.sin(a) * rr]; }],
    [straightH, (u) => [b.x, b.y + h - rr - u]],
    [arc, (u) => { const a = Math.PI + u / rr; return [b.x + rr + Math.cos(a) * rr, b.y + rr + Math.sin(a) * rr]; }],
  ];
  for (const [len, f] of seg) { if (d <= len) return f(d); d -= len; }
  return [b.x + rr, b.y];
}

export function mountCursor() {
  if (!matchMedia("(pointer: fine)").matches || reducedMotion()) return { setHeat() {}, el: null };
  const cv = document.createElement("canvas");
  cv.className = "lx-cursor";
  cv.setAttribute("aria-hidden", "true");
  document.body.appendChild(cv);
  document.documentElement.classList.add("has-cursor");
  const g = cv.getContext("2d");
  let dpr = 1;
  const fit = () => { dpr = Math.min(2, devicePixelRatio || 1); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
  addEventListener("resize", fit); fit();

  const N = 30;
  const dots = new Dots(N);
  dots.k = 140; dots.damp = 12;
  let px = -100, py = -100, inside = false, target = null, heat = 0, spin = 0, lastTarget = null;
  let ink = css("--ink") || "#ece7da", hot = css("--hot") || "#ff5a1f";
  new MutationObserver(() => { ink = css("--ink"); hot = css("--hot"); }).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-world"] });

  addEventListener("pointermove", (e) => {
    px = e.clientX; py = e.clientY;
    if (!inside) { inside = true; for (let i = 0; i < N; i++) dots.place(i, px, py); }
    const t = e.target.closest?.(TARGETS);
    target = t && !t.closest("[data-no-halo]") ? t : null;
  }, { passive: true });
  document.addEventListener("pointerleave", () => (inside = false));
  addEventListener("pointerdown", () => { dots.burst(px, py, 220); });
  // keyboard focus gets the same outline, so the halo is also a focus indicator
  document.addEventListener("focusin", (e) => { if (e.target.matches?.(":focus-visible") && e.target.matches(TARGETS)) target = e.target; });
  document.addEventListener("focusout", () => { if (document.activeElement === document.body) target = null; });

  clock.add((dt, t) => {
    g.clearRect(0, 0, innerWidth, innerHeight);
    if (!inside && !target) return;
    spin += dt;
    if (target && target.isConnected) {
      const r = target.getBoundingClientRect();
      const pad = 6;
      const b = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
      const rad = parseFloat(getComputedStyle(target).borderRadius) + pad || pad * 2;
      if (lastTarget !== target) { dots.stagger(0.14, (i) => Math.hypot(dots.x[i] - (b.x + b.w / 2), dots.y[i] - (b.y + b.h / 2))); lastTarget = target; }
      for (let i = 0; i < N; i++) { const [x, y] = roundRectPoint(b, rad, i / N + spin * 0.035); dots.home(i, x, y, 0.95); }
    } else {
      lastTarget = null;
      const R = 11 + heat * 12;
      for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2 + spin * 0.6; dots.home(i, px + Math.cos(a) * R, py + Math.sin(a) * R, i % 3 === 0 || heat > 0.02 ? 0.75 : 0); }
    }
    dots.step(dt);
    const hotCount = Math.round(heat * N);
    dots.draw(g, { ink, hot, r: 1.25, hotOf: (i) => (i < hotCount ? 1 : 0) });
    if (inside) { g.fillStyle = hot; g.beginPath(); g.arc(px, py, 2.6, 0, Math.PI * 2); g.fill(); }
  });

  return { el: cv, setHeat(v) { heat = v; } };
}
