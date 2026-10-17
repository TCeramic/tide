// Adapted from design-systems/lattice/src/dom/controls.js mountProgress, MIT © 2026 DayDreamInAReverie.
// Keep original gas-to-crystal physics; bound visibility, pause work and lifecycle; no progress sounds.
import { clock, reducedMotion } from "./vendor/design-systems/lattice/src/core/motion.js";
import { Dots, css } from "./vendor/design-systems/lattice/src/dom/dotkit.js";
import { isRenderingActive } from "./render-activity.ts";
const colors=()=>({ink:css("--ink"),hot:css("--hot")});
function mountCanvas(host) {
  const cv=document.createElement("canvas");cv.className="lx-canvas";cv.setAttribute("aria-hidden","true");cv.style.cssText="position:absolute;inset:0;width:100%;height:100%;pointer-events:none";host.append(cv);
  const g=cv.getContext("2d"),size={w:0,h:0,dpr:1};
  const fit=()=>{const r=host.getBoundingClientRect();size.w=r.width;size.h=r.height;size.dpr=Math.min(1.5,devicePixelRatio||1);cv.width=Math.max(1,Math.round(size.w*size.dpr));cv.height=Math.max(1,Math.round(size.h*size.dpr));g.setTransform(size.dpr,0,0,size.dpr,0,0);};
  const observer=new ResizeObserver(fit);observer.observe(host);fit();return {g,size,destroy(){observer.disconnect();cv.remove();}};
}
export function mountProgress(el) {
  const surface = mountCanvas(el), { g, size } = surface;
  let lastChange=clock.time, frame=0, last=0, dead=false;
  let dots, cols = 0, rows = 3, value = 0, target = parseFloat(el.dataset.value || "0"), indeterminate = el.hasAttribute("data-indeterminate");
  let locked, flash, anchor, solidPrev;
  const site = (i) => { const c = i % cols, r = Math.floor(i / cols); const pitch = size.w / cols, oy = (size.h - (rows - 1) * 5) / 2; return [(c + 0.5) * pitch, oy + r * 5, c / (cols - 1)]; };
  const build = () => {
    lastChange=clock.time;
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
  const resize = new ResizeObserver(()=>{build();wake();}); resize.observe(el);
  build();
  el.setAttribute("role", "progressbar");
  el.setAttribute("aria-valuemin", "0"); el.setAttribute("aria-valuemax", "100");
  let done = false;
  const visible=()=>!el.closest('.dock-shell')||document.documentElement.dataset.dockVisible==='true';
  let cl = colors();
  const theme = new MutationObserver(()=>{cl=colors();lastChange=clock.time;wake();}); theme.observe(document.documentElement,{attributes:true,attributeFilter:["data-world","data-color-mode","data-performance","data-shell","data-dock-visible"]});
  const api = {
    set(v) { const next=Math.max(0,Math.min(1,v));if(next!==target)lastChange=clock.time;target=next; indeterminate = false; el.setAttribute("aria-valuenow", String(Math.round(target * 100)));wake(); },
    indeterminate(on = true) { indeterminate = on; el.removeAttribute("aria-valuenow"); },
    get value() { return target; },
  };
  function render(now) {
    frame=0;
    if(dead || !visible() || !isRenderingActive() || document.documentElement.dataset.shell!=="lattice" || size.w<=0 || size.h<=0 || (el.dataset.playing!=="true" && clock.time-lastChange>1.2)){last=0;return;}
    const fps=document.documentElement.dataset.performance === "vivid" ? 120 : 30;
    if(last && now-last<1000/fps-.5){wake();return;}
    const dt=last?Math.min(.05,(now-last)/1000):1/fps,t=clock.time;last=now;
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

    const complete = !indeterminate && value > 0.995;
    if (complete && !done) { done = true; el.classList.add("is-complete"); for (let i = 0; i < dots.n; i++) flash[i] = Math.max(flash[i], 0.6); }
    if (!complete) { done = false; el.classList.remove("is-complete"); }
    dots.step(dt);

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
    wake();
  }
  function wake(){if(!dead&&!frame&&visible()&&isRenderingActive()&&document.documentElement.dataset.shell==="lattice")frame=requestAnimationFrame(render);}
  const activity=()=>{cancelAnimationFrame(frame);frame=0;last=0;wake();};document.addEventListener("visibilitychange",activity);
  api.set(target);
  el._progress = api;
  api.destroy=()=>{dead=true;cancelAnimationFrame(frame);document.removeEventListener("visibilitychange",activity);resize.disconnect();theme.disconnect();surface.destroy();};
  return api;
}
