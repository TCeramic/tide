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
    else { cancelAnimationFrame(renderer.frame); renderer.frame = 0; }
  };
  document.addEventListener("visibilitychange", activity);
  activity();
  portals.dataset.lens = "true";
  return {
    sync(next) {
      appearance = next;
      system.setScene(next.theme === "dusk" ? "ocean" : "aurora");
      system.renderer?.set({motion:next.motion > 0});
      if (system.renderer) system.renderer.canvas.style.opacity = String(next.stageLevel);
      system.jelly.setIntensity(next.motion > 0 ? next.motion * 0.7 : 0);
      portals.dataset.scene = next.theme === "dusk" ? "ocean" : "aurora";
    },
    invalidateScene() { system.setScene(appearance?.theme === "dusk" ? "ocean" : "aurora"); },
    destroy() {
      dead = true; document.removeEventListener("visibilitychange", activity); cancelAnimationFrame(frame); observer.disconnect(); system.destroy();
      root.classList.remove("lg-stage","fallback","webgl-ready");
      delete portals.dataset.lens; delete portals.dataset.scene;
      for (const el of surfaces) { el.classList.remove("lg-surface"); delete el.dataset.glass; }
      surfaces.clear();
    },
  };
}
