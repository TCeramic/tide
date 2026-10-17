import { isRenderingActive } from "./render-activity";
import { ShaderMount, meshGradientFragmentShader, getShaderColorFromString } from "@paper-design/shaders";
import type { Appearance } from "../shared/contract";
import type { GeneratedTheme } from "../core/generated-theme";

/** Original Apache-2.0 Paper shader, with Tide lifecycle and bounded resolution. */
export function mountPaperBackground(root: HTMLElement, invalidate: () => void) {
  const host = document.createElement("div"); host.className = "native-paper-source"; host.setAttribute("aria-hidden", "true"); root.prepend(host);
  let shader: ShaderMount | null = null;
  let frame = 0, copyTimer = 0, shaderTime = 0, lastTick = 0, lastCopy = 0, dead = false, current: Appearance | null = null;
  let colors = ["#101a27", "#427d92", "#ad91af", "#23394b"];
  const uniforms = () => ({
    u_colors: colors.map(color => { const [r, g, b, a] = getShaderColorFromString(color); const gain=(current?.shell==="lattice"?current.latticeMode:current?.lensMode)==="light"?.95:.72;return [r*gain,g*gain,b*gain,a]; }), u_colorsCount: colors.length, u_distortion: 0.72, u_swirl: 0.65, u_grainMixer: 0.03, u_grainOverlay: 0.025,
    u_fit: 2, u_scale: 1, u_rotation: 0, u_originX: 0.5, u_originY: 0.5, u_offsetX: 0, u_offsetY: 0, u_worldWidth: 0, u_worldHeight: 0,
  });
  const palette = (event: Event) => {
    const detail = (event as CustomEvent<GeneratedTheme>).detail;
    if (detail?.colors) { colors = detail.colors; shader?.setUniforms(uniforms()); wake(); }
  };
  const copyFrame = (time: number) => {
    frame = 0;
    if (dead || current?.background !== "paper") return;
    if (!isRenderingActive()) { lastTick = 0; return; }
    shaderTime += (lastTick ? Math.min(100, time - lastTick) : 0) * current.motion * .65; lastTick = time;
    const interval=current.performance==="smooth"?1000:current.performance==="vivid"?1000/60:1000/30;
    if (time - lastCopy >= interval || lastCopy === 0) { shader?.setFrame(shaderTime); invalidate(); lastCopy = time; }
    if (current.performance!=="smooth" && current.motion > 0 && !matchMedia("(prefers-reduced-motion: reduce)").matches) copyTimer = window.setTimeout(() => { copyTimer = 0; frame = requestAnimationFrame(copyFrame); }, interval);
  };
  const wake = () => { shader?.setSpeed(0); cancelAnimationFrame(frame); clearTimeout(copyTimer); copyTimer = 0; frame = 0; lastTick = 0; lastCopy = 0; if (!dead && isRenderingActive()) frame = requestAnimationFrame(copyFrame); };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("tide:palette", palette);
  return {
    get canvas() { return host.querySelector("canvas"); },
    sync(next: Appearance) {
      current = next;
      const active = next.background === "paper";
      if (active && !shader) {
        try {
          const stored = JSON.parse(document.documentElement.style.getPropertyValue("--generated-colors") || "null");
          if (Array.isArray(stored)) colors = stored;
          shader = new ShaderMount(host, meshGradientFragmentShader, uniforms(), { alpha: false, preserveDrawingBuffer: true }, 0, 0, 1, next.performance === "smooth" ? 500000 : 1000000);
          host.dataset.ready = "true";
        } catch { host.dataset.ready = "fallback"; }
      }
      if(!active&&shader){shader.dispose();shader=null;delete host.dataset.ready;}
      host.dataset.active = String(active);
      host.style.opacity = active && next.shell === "lattice" ? "0.65" : "0";
      shader?.setSpeed(0);
      shader?.setMaxPixelCount(next.performance === "smooth" ? 500000 : 1000000);
      wake();
    },
    destroy() { dead = true; clearTimeout(copyTimer); cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", wake); window.removeEventListener("tide:palette", palette); shader?.dispose(); host.remove(); },
  };
}
