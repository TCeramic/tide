import type { PerformanceTier } from "../shared/contract";

/**
 * What a performance tier actually turns off.
 * Smooth drops WebGL, the far glow, and most points.
 * Vivid keeps them. Balanced sits between the two.
 */
export interface PerformanceBudget {
  tier: PerformanceTier;
  webgl: boolean;
  latticePoints: number;
  voxels: boolean;
  /** Backdrop blur in CSS pixels. Zero means the glass is flat. */
  blurPx: number;
  deskFarGlow: boolean;
  deskFps: number;
  proofPoints: number;
}

const BUDGETS: Record<PerformanceTier, PerformanceBudget> = {
  smooth: {
    tier: "smooth",
    webgl: false,
    latticePoints: 24,
    voxels: false,
    blurPx: 0,
    deskFarGlow: false,
    deskFps: 30,
    proofPoints: 0,
  },
  balanced: {
    tier: "balanced",
    webgl: true,
    latticePoints: 48,
    voxels: true,
    blurPx: 12,
    deskFarGlow: true,
    deskFps: 45,
    proofPoints: 1,
  },
  vivid: {
    tier: "vivid",
    webgl: true,
    latticePoints: 80,
    voxels: true,
    blurPx: 22,
    deskFarGlow: true,
    deskFps: 60,
    proofPoints: 1,
  },
};

export function performanceBudget(tier: PerformanceTier): PerformanceBudget {
  return BUDGETS[tier];
}

/** True when two tiers would not paint the same set of heavy effects. */
export function budgetsDiffer(left: PerformanceTier, right: PerformanceTier): boolean {
  const a = performanceBudget(left);
  const b = performanceBudget(right);
  return a.webgl !== b.webgl
    || a.latticePoints !== b.latticePoints
    || a.voxels !== b.voxels
    || a.blurPx !== b.blurPx
    || a.deskFarGlow !== b.deskFarGlow
    || a.deskFps !== b.deskFps
    || a.proofPoints !== b.proofPoints;
}
