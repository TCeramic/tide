import { isRenderingActive } from "./render-activity";
import { ShaderMount, meshGradientFragmentShader, getShaderColorFromString } from "@paper-design/shaders";
import type { Appearance } from "../shared/contract";
import type { GeneratedTheme } from "../core/generated-theme";

/** Original Apache-2.0 Paper shader, with Tide lifecycle and bounded resolution. */
export function mountPaperBackground(root: HTMLElement, invalidate: () => void) {
  const host = document.createElement("div"); host.className = "native-paper-source"; host.setAttribute("aria-hidden", "true"); root.prepend(host);
  let shader: ShaderMount | null = null;
  let frame = 0, lastCopy = 0, dead = false, current: Appearance | null = null;
  let colors = ["#101a27", "#427d92", "#ad91af", "#23394b"];
  const uniforms = () => ({
    u_colors: colors.map(color => { const [r, g, b, a] = getShaderColorFromString(color); return [r * 0.4, g * 0.4, b * 0.4, a]; }), u_colorsCount: colors.length, u_distortion: 0.35, u_swirl: 0.3, u_grainMixer: 0.03, u_grainOverlay: 0.025,
    u_fit: 2, u_scale: 1, u_rotation: 0, u_originX: 0.5, u_originY: 0.5, u_offsetX: 0, u_offsetY: 0, u_worldWidth: 0, u_worldHeight: 0,
  });
  const palette = (event: Event) => {
    const detail = (event as CustomEvent<GeneratedTheme>).detail;
    if (detail?.colors) { colors = detail.colors; shader?.setUniforms(uniforms()); wake(); }
  };
  const copyFrame = (time: number) => {
    frame = 0;
    if (dead || current?.background !== "paper") return;
    if (isRenderingActive() && (time - lastCopy > (current.performance === "smooth" ? 500 : 200) || lastCopy === 0)) { invalidate(); lastCopy = time; }
    if (current.motion > 0 && isRenderingActive() && !matchMedia("(prefers-reduced-motion: reduce)").matches) frame = requestAnimationFrame(copyFrame);
  };
  const wake = () => { shader?.setSpeed(isRenderingActive() && current?.background === "paper" ? (current.motion * .2) : 0); lastCopy = 0; if (!dead && !frame) frame = requestAnimationFrame(copyFrame); };
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
          shader = new ShaderMount(host, meshGradientFragmentShader, uniforms(), { alpha: false, preserveDrawingBuffer: true }, next.motion * 0.2, 0, 1, next.performance === "smooth" ? 500000 : 1000000);
          host.dataset.ready = "true";
        } catch { host.dataset.ready = "fallback"; }
      }
      host.dataset.active = String(active);
      host.style.opacity = active && next.shell === "lattice" ? "0.45" : "0";
      shader?.setSpeed(active && isRenderingActive() && next.motion > 0 && !matchMedia("(prefers-reduced-motion: reduce)").matches ? next.motion * 0.2 : 0);
      shader?.setMaxPixelCount(next.performance === "smooth" ? 500000 : 1000000);
      wake();
    },
    destroy() { dead = true; cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", wake); window.removeEventListener("tide:palette", palette); shader?.dispose(); host.remove(); },
  };
}
