import { stepSpring, type Spring } from "./spring";

export interface LatticePoint {
  x: number;
  y: number;
  r: number;
}

export interface LatticeSpring {
  x: Spring;
  y: Spring;
}

/**
 * A bounded point set for the optional playback layer.
 * `energy` is 0 while idle and 1 while audio is playing. Points stay inside the unit square.
 */
export function latticeTargets(count: number, phase: number, energy: number): LatticePoint[] {
  const n = Math.max(0, Math.min(96, Math.floor(count)));
  const amount = clamp01(energy);
  const turn = Number.isFinite(phase) ? phase : 0;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.35)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const points: LatticePoint[] = [];
  let index = 0;
  for (let y = 0; y < rows && index < n; y += 1) {
    for (let x = 0; x < cols && index < n; x += 1) {
      const u = (x + 0.5) / cols;
      const v = (y + 0.5) / rows;
      const wobbleX = amount * 0.018 * Math.sin(turn * Math.PI * 2 + (x + y) * 0.65);
      const wobbleY = amount * 0.018 * Math.cos(turn * Math.PI * 2 + x * 0.45);
      points.push({
        x: clamp01(u + wobbleX),
        y: clamp01(v + wobbleY),
        r: 1.15 + amount * (0.35 + 0.45 * (0.5 + 0.5 * Math.sin(turn * Math.PI * 2 + index))),
      });
      index += 1;
    }
  }
  return points;
}

export function stepLattice(springs: readonly LatticeSpring[], targets: readonly LatticePoint[], dt: number): LatticeSpring[] {
  return targets.map((target, index) => {
    const spring = springs[index] ?? {
      x: { value: target.x, velocity: 0 },
      y: { value: target.y, velocity: 0 },
    };
    return {
      x: stepSpring(spring.x, target.x, dt),
      y: stepSpring(spring.y, target.y, dt),
    };
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
