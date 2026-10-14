import { latticeTargets, stepLattice, type LatticeSpring } from "../lattice-field";
import { onLattice, readLattice } from "../lattice-pref";
import { mountLensField, type LensField } from "./lens-field";

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
  destroy: () => void;
} {
  root.replaceChildren();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let field: LensField | null = reduce ? null : mountLensField(root);
  if (field) root.append(field.canvas);
  const lattice = document.createElement("canvas");
  lattice.className = "lattice-field";
  lattice.hidden = !readLattice();
  lattice.setAttribute("aria-hidden", "true");
  root.append(lattice);
  let scene: StageScene = { level: 1, motion: 1, playing: false };
  let raf = 0;
  let last = 0;
  let slow = 0;
  let frames = 0;
  let springs: LatticeSpring[] = [];
  const context = lattice.getContext("2d", { alpha: true });

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
    const targets = latticeTargets(64, phase(), energy);
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
    if (field) {
      const ok = field.draw(phase(), document.documentElement.dataset.theme === "dusk");
      frames += 1;
      if (!ok && frames > 20) {
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

  const sync = () => {
    lattice.hidden = !readLattice();
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
  const stopLattice = onLattice(() => sync());
  document.addEventListener("visibilitychange", sync);
  sync();

  return {
    setScene(next) {
      scene = next;
      sync();
    },
    destroy() {
      stopLoop();
      stopLattice();
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      field?.destroy();
      root.replaceChildren();
    },
  };
}
