import { isRenderingActive } from "./render-activity.ts";
import { createGlassSystem } from "./vendor/design-systems/lens/lab/design-system/index.js";

/** One upstream optical stage. Scrollable portals and text stay in ordinary DOM. */
export function mountLensShell(root, portals, artwork) {
  const surfaces = new Set();
  const selector = ".home-card,.browse-sheet,.transport,.topbar,.risk";
  let dead = false, frame = 0, appearance;
  const system = createGlassSystem(root, { material:"thick", scene:"aurora", artwork, motion:false, audio:{},
    onFallback: () => { root.dataset.nativeFallback = "lens"; },
  });
  let renderTimer = 0, lastPaint = 0, interactionUntil = 0;
  const renderer = system.renderer;
  const originalRender = renderer?.render.bind(renderer);
  const interactive = () => { interactionUntil = performance.now() + 700; renderer?.invalidate(); };
  for (const event of ["pointermove", "pointerdown", "wheel", "focusin"]) root.addEventListener(event, interactive, { passive: true });
  if (renderer) {
    // Filter visual-only lyric mutations out of the glass geometry observer.
    renderer.mutationObserver.disconnect();
    renderer.mutationObserver = new MutationObserver(records => {
      if (!isRenderingActive()) return;
      const changed = records.some(record => record.target instanceof Element && (record.target.closest('.lg-surface') || record.target.querySelector('.lg-surface') || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches('.lg-surface') || node.querySelector('.lg-surface')))));
      if (changed) renderer.invalidate(0, true);
    });
    renderer.mutationObserver.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-selected', 'aria-pressed', 'aria-checked'] });
    renderer.render = now => {
      renderer.frame = 0;
      if (dead || !isRenderingActive()) return;
      const fps = now < interactionUntil ? 60 : appearance?.performance === "vivid" ? 60 : 30;
      const wait = 1000 / fps - (now - lastPaint);
      if (wait > 1) {
        if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = 0; if (!dead && isRenderingActive() && !renderer.frame) renderer.frame = requestAnimationFrame(renderer.render); }, wait);
        return;
      }
      clearTimeout(renderTimer); renderTimer = 0; lastPaint = now; originalRender(now);
    };
    // Bounded physical resolution for the expensive optical ping-pong targets.
    renderer.resize = () => {
      if (renderer.destroyed || renderer.suspended || renderer.lost || !renderer.gl) return;
      const rect = root.getBoundingClientRect();
      const maxPixels = appearance?.performance === "vivid" ? 1600000 : appearance?.performance === "smooth" ? 650000 : 1000000;
      renderer.dpr = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(maxPixels / Math.max(1, rect.width * rect.height)));
      const width = Math.max(1, Math.round(rect.width * renderer.dpr)), height = Math.max(1, Math.round(rect.height * renderer.dpr));
      if (width === renderer.width && height === renderer.height) return;
      renderer.width = width; renderer.height = height; renderer.canvas.width = width; renderer.canvas.height = height;
      const gl = renderer.gl;
      for (const target of renderer.targets) { gl.bindTexture(gl.TEXTURE_2D, target.texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); renderer.setScene(renderer.settings.scene); renderer.rectDirty = true;
    };
    renderer.resize();
  }
  const decorate = () => {
    frame = 0;
    if (dead) return;
    for (const el of surfaces) if (!el.isConnected) surfaces.delete(el);
    for (const el of root.querySelectorAll(selector)) {
      if (surfaces.has(el)) continue;
      surfaces.add(el); el.classList.add("lg-surface");
      el.dataset.glass = el.matches(".transport") ? "dock" : "panel";
    }
    system.mount();
  };
  const observer = new MutationObserver(records => {
    const relevant = records.some(record => [...record.addedNodes,...record.removedNodes].some(node =>
      node instanceof Element && (node.matches(selector) || node.querySelector(selector))));
    if (relevant && !frame) frame = requestAnimationFrame(decorate);
  });
  observer.observe(root,{childList:true,subtree:true}); decorate();
  const activity = () => {
    const renderer = system.renderer;
    if (!renderer) return;
    renderer.visible = isRenderingActive();
    if (!renderer.visible) { cancelAnimationFrame(system.jelly.frame); system.jelly.frame = 0; system.jelly.last = 0; }
    else system.jelly.wake();
    if (renderer.visible) renderer.invalidate();
    else { clearTimeout(renderTimer); renderTimer = 0; cancelAnimationFrame(renderer.frame); renderer.frame = 0; }
  };
  document.addEventListener("visibilitychange", activity);
  activity();
  portals.dataset.lens = "true";
  return {
    sync(next) {
      appearance = next; system.renderer?.resize();
      system.setScene((next.lensMode ?? (next.theme === "dusk" ? "dark" : "light")) === "dark" ? "ocean" : "aurora");
      system.renderer?.set({motion:next.motion > 0});
      if (system.renderer) system.renderer.canvas.style.opacity = String(next.stageLevel);
      system.jelly.setIntensity(next.motion > 0 ? next.motion * 0.7 : 0);
      portals.dataset.scene = (next.lensMode ?? (next.theme === "dusk" ? "dark" : "light")) === "dark" ? "ocean" : "aurora";
    },
    invalidateScene() { system.setScene((appearance?.lensMode ?? (appearance?.theme === "dusk" ? "dark" : "light")) === "dark" ? "ocean" : "aurora"); },
    destroy() {
      dead = true; clearTimeout(renderTimer); for (const event of ["pointermove", "pointerdown", "wheel", "focusin"]) root.removeEventListener(event, interactive); document.removeEventListener("visibilitychange", activity); cancelAnimationFrame(frame); observer.disconnect(); system.destroy();
      root.classList.remove("lg-stage","fallback","webgl-ready");
      delete portals.dataset.lens; delete portals.dataset.scene;
      for (const el of surfaces) { el.classList.remove("lg-surface"); delete el.dataset.glass; }
      surfaces.clear();
    },
  };
}
