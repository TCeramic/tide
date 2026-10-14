import { performanceBudget } from "../../core/performance";
import { latticeTargets, stepLattice, type LatticeSpring } from "../lattice-field";
import { mountLensField, type LensField } from "./lens-field";
import { paintVoxels } from "./voxel-field";

export interface StageScene {
  level: number;
  motion: number;
  playing: boolean;
}

/**
 * Stage behind the shell. The liquid wash is CSS, with an optional WebGL2
 * field that drops out on failure. Lattice is a separate canvas and stays
 * hidden until the user turns it on.
 */
export function mountStage(root: HTMLElement): {
  setScene: (scene: StageScene) => void;
  setLattice: (on: boolean) => void;
  destroy: () => void;
} {
  root.replaceChildren();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let field: LensField | null = reduce ? null : mountLensField(root);
  if (field) root.append(field.canvas);
  const lattice = document.createElement("canvas");
  lattice.className = "lattice-field";
  lattice.hidden = true;
  lattice.setAttribute("aria-hidden", "true");
  root.append(lattice);
  const voxels = document.createElement("canvas");
  voxels.className = "voxel-field";
  voxels.setAttribute("aria-hidden", "true");
  root.append(voxels);
  const voxelContext = voxels.getContext("2d", { alpha: true });
  let scene: StageScene = { level: 1, motion: 1, playing: false };
  let raf = 0;
  let last = 0;
  let slow = 0;
  let frames = 0;
  let springs: LatticeSpring[] = [];
  const context = lattice.getContext("2d", { alpha: true });

  const tier = () => {
    const value = document.documentElement.dataset.performance;
    return value === "smooth" || value === "vivid" ? value : "balanced";
  };

  const phase = (): number => {
    const raw = Number.parseFloat(document.documentElement.style.getPropertyValue("--tide-phase"));
    return Number.isFinite(raw) ? raw : 0.5;
  };

  const paintLattice = (dt: number) => {
    if (!context || lattice.hidden) return;
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (width < 2 || height < 2) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const bufferW = Math.floor(width * ratio);
    const bufferH = Math.floor(height * ratio);
    if (lattice.width !== bufferW || lattice.height !== bufferH) {
      lattice.width = bufferW;
      lattice.height = bufferH;
    }
    const energy = scene.playing ? 1 : 0.12;
    const budget = performanceBudget(tier());
    const targets = latticeTargets(budget.latticePoints, phase(), budget.webgl ? energy : energy * 0.4);
    springs = stepLattice(springs, targets, reduce ? 1 : dt);
    context.clearRect(0, 0, bufferW, bufferH);
    context.fillStyle = document.documentElement.dataset.theme === "dusk"
      ? "rgba(255, 220, 186, 0.88)"
      : "rgba(214, 248, 244, 0.9)";
    for (let i = 0; i < targets.length; i += 1) {
      const spring = springs[i];
      const target = targets[i];
      if (!spring || !target) continue;
      const dot = Math.max(1.8, target.r * ratio * 2.2);
      context.beginPath();
      context.arc(spring.x.value * bufferW, spring.y.value * bufferH, dot, 0, Math.PI * 2);
      context.fill();
    }
  };

  const paint = (now: number) => {
    const dt = last === 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
    last = now;
      const preset = document.documentElement.dataset.preset;
      const background = document.documentElement.dataset.background;
      const allowLens = performanceBudget(tier()).webgl
        && preset !== "quiet"
        && preset !== "stardust"
        && preset !== "cover-glow"
        && background !== "cover"
        && background !== "image";
    if (field) {
      field.canvas.hidden = !allowLens;
      const ok = !allowLens || field.draw(phase(), document.documentElement.dataset.theme === "dusk");
      frames += 1;
      if (allowLens && !ok && frames > 20) {
        slow += 1;
        if (slow > 8) {
          field.destroy();
          field = null;
          root.classList.remove("has-lens-field");
        }
      } else if (ok) {
        slow = 0;
      }
    }
    paintLattice(dt);
    paintVoxelLayer();
  };

  const paintVoxelLayer = () => {
    if (!voxelContext) return;
    const allow = document.documentElement.dataset.view === "playing"
      && performanceBudget(tier()).voxels
      && document.documentElement.dataset.preset !== "quiet";
    voxels.hidden = !allow;
    if (!allow) return;
    const width = voxels.clientWidth;
    const height = voxels.clientHeight;
    if (width < 2 || height < 2) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const bufferW = Math.floor(width * ratio);
    const bufferH = Math.floor(height * ratio);
    if (voxels.width !== bufferW || voxels.height !== bufferH) {
      voxels.width = bufferW;
      voxels.height = bufferH;
    }
    paintVoxels(voxelContext, bufferW, bufferH, phase(), scene.playing);
  };

  const moving = (): boolean => {
    if (reduce || scene.level <= 0 || document.hidden) return false;
    if (field && scene.motion > 0) return true;
    return !lattice.hidden && scene.playing;
  };

  const stopLoop = () => {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  };

  const loop = (now: number) => {
    raf = 0;
    if (!moving()) {
      paint(now);
      return;
    }
    paint(now);
    raf = requestAnimationFrame(loop);
  };

  let latticeOn = false;
  const sync = () => {
    lattice.hidden = !latticeOn;
    root.classList.toggle("has-lens-field", field !== null);
    if (moving()) {
      if (raf === 0) raf = requestAnimationFrame(loop);
      return;
    }
    stopLoop();
    paint(performance.now());
  };

  const onResize = () => sync();
  const observer = new ResizeObserver(onResize);
  observer.observe(root);
  document.addEventListener("visibilitychange", sync);
  sync();

  return {
    setScene(next) {
      scene = next;
      sync();
    },
    setLattice(on) {
      latticeOn = on;
      sync();
    },
    destroy() {
      stopLoop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      field?.destroy();
      root.replaceChildren();
    },
  };
}
