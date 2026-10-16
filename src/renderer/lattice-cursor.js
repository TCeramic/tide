import { isRenderingActive } from "./render-activity.ts";
// Adapted from design-systems/lattice/src/dom/cursor.js, MIT © 2026 DayDreamInAReverie.
// Only lifecycle cleanup and the desktop pixel budget differ.
// 眼 Cursor — a point with a small set around it. Over anything you can act on, the set leaves the
// pointer and re-forms along that control's outline (the "meteors converge into the option" idea);
// pressing bursts it; holding on the field turns the ring hot as the points melt.
import { reducedMotion } from "./vendor/design-systems/lattice/src/core/motion.js";
import { Dots, css } from "./vendor/design-systems/lattice/src/dom/dotkit.js";

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
  const abort = new AbortController();
  const listen = (name, fn, options = {}) => window.addEventListener(name, fn, { ...options, signal: abort.signal });
  const cv = document.createElement("canvas");
  cv.className = "lx-cursor";
  cv.setAttribute("aria-hidden", "true");
  document.body.appendChild(cv);
  document.documentElement.classList.add("has-cursor");
  const g = cv.getContext("2d");
  cv.style.cssText = "inset:auto;left:0;top:0;width:64px;height:64px;contain:strict";
  let dpr = Math.min(1.25, devicePixelRatio || 1), boxStamp = 0, outline = null;
  listen("resize", () => { dpr = Math.min(1.25, devicePixelRatio || 1); boxStamp = 0; });
  listen("scroll", () => { boxStamp = 0; }, { capture: true, passive: true });
  let frame = 0, last = 0, dead = false, motion = true;

  const N = 30;
  const dots = new Dots(N);
  dots.k = 140; dots.damp = 12;
  let px = -100, py = -100, inside = false, target = null, heat = 0, spin = 0, lastTarget = null;
  let ink = css("--ink") || "#ece7da", hot = css("--hot") || "#ff5a1f";
  const observer = new MutationObserver(() => { ink = css("--ink"); hot = css("--hot"); });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-world", "data-color-mode"] });

  listen("pointermove", (e) => {
    px = e.clientX; py = e.clientY;
    if (!inside) { inside = true; for (let i = 0; i < N; i++) dots.place(i, px, py); }
    const t = e.target.closest?.(TARGETS);
    const next = t && !t.closest("[data-no-halo]") ? t : null;
    if (next !== target) { boxStamp = 0; target = next; }
    wake();
  }, { passive: true });
  listen("pointerout", e => { if (!e.relatedTarget) { inside = false; target = null; wake(); } });
  listen("pointerdown", () => { dots.burst(px, py, 220); });
  // keyboard focus gets the same outline, so the halo is also a focus indicator
  listen("focusin", (e) => { if (e.target.matches?.(":focus-visible") && e.target.matches(TARGETS)) target = e.target; });
  listen("focusout", () => { if (document.activeElement === document.body) target = null; });

  function tick(now) {
    frame = 0;
    if (dead || !isRenderingActive()) { last = 0; return; }
    if (last && now - last < 1000 / 60 - .5) { wake(); return; }
    const dt = last ? Math.min(.05, (now - last) / 1000) : 1 / 60; last = now;
    g.setTransform(1,0,0,1,0,0); g.clearRect(0,0,cv.width,cv.height);
    if (!inside && !target) { last = 0; return; }
    spin += motion ? dt : 0;
    if (target && target.isConnected) {
      if (!boxStamp || now - boxStamp > 150) {
        const r = target.getBoundingClientRect(), pad = 6;
        const b = { x:r.left-pad,y:r.top-pad,w:r.width+pad*2,h:r.height+pad*2 };
        const rad = parseFloat(getComputedStyle(target).borderRadius) + pad || pad * 2;
        outline = { b, samples:Array.from({length:128},(_,i)=>roundRectPoint(b,rad,i/128)) }; boxStamp = now;
      }
      const { b, samples } = outline;
      if (lastTarget !== target) { dots.stagger(0.14, (i) => Math.hypot(dots.x[i] - (b.x + b.w / 2), dots.y[i] - (b.y + b.h / 2))); lastTarget = target; }
      for (let i = 0; i < N; i++) { const at=((i/N+spin*.035)%1)*128,j=Math.floor(at),mix=at-j,a=samples[j],z=samples[(j+1)%128]; const x=a[0]+(z[0]-a[0])*mix,y=a[1]+(z[1]-a[1])*mix; dots.home(i, x, y, 0.95); }
    } else {
      lastTarget = null;
      const R = 11 + heat * 12;
      for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2 + spin * 0.6; dots.home(i, px + Math.cos(a) * R, py + Math.sin(a) * R, i % 3 === 0 || heat > 0.02 ? 0.75 : 0); }
    }
    dots.step(dt);
    // Only rasterize the small occupied tile, rather than clearing/compositing the desktop.
    let left=inside?px:Infinity,top=inside?py:Infinity,right=inside?px:-Infinity,bottom=inside?py:-Infinity;
    for(let i=0;i<N;i++){left=Math.min(left,dots.x[i]);top=Math.min(top,dots.y[i]);right=Math.max(right,dots.x[i]);bottom=Math.max(bottom,dots.y[i]);}
    left=Math.floor(left-12);top=Math.floor(top-12);
    const width=Math.max(64,Math.ceil((right-left+12)/64)*64),height=Math.max(64,Math.ceil((bottom-top+12)/64)*64);
    const w=Math.round(width*dpr),h=Math.round(height*dpr);
    if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h;cv.style.width=`${width}px`;cv.style.height=`${height}px`;}
    cv.style.transform=`translate3d(${left}px,${top}px,0)`;
    g.setTransform(dpr,0,0,dpr,-left*dpr,-top*dpr);
    const hotCount = Math.round(heat * N);
    dots.draw(g, { ink, hot, r: 1.25, hotOf: (i) => (i < hotCount ? 1 : 0) });
    if (inside) { g.fillStyle = hot; g.beginPath(); g.arc(px, py, 2.6, 0, Math.PI * 2); g.fill(); }
    if (motion || dots.step(0)) wake();
  }
  function wake() { if (!dead && !frame && isRenderingActive()) frame=requestAnimationFrame(tick); }
  listen("visibilitychange", () => { cancelAnimationFrame(frame); frame=0;last=0;if(isRenderingActive())wake(); });
  return { el:cv, sync(next) { motion=next.motion>0&&!reducedMotion();wake(); }, setHeat(v) { heat=v;wake(); }, destroy() { dead=true;cancelAnimationFrame(frame);abort.abort(); observer.disconnect(); cv.remove(); document.documentElement.classList.remove("has-cursor"); } };
}
