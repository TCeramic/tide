export interface Spring {
  value: number;
  velocity: number;
}

/**
 * Damped spring used by Lens-style control settle and the lattice field.
 * The idea (controls return with a damped spring, and reduced motion snaps)
 * is adapted from Lens, Copyright (c) 2026 DayDreamInAReverie, MIT.
 * https://github.com/ruiqichenbiec/design-systems
 * This stepper is original Tide code, not a copy of that repository.
 */
export function stepSpring(state: Spring, target: number, dt: number, stiffness = 180, damping = 22): Spring {
  const step = Math.min(0.05, Math.max(0, dt));
  const accel = stiffness * (target - state.value) - damping * state.velocity;
  const velocity = state.velocity + accel * step;
  const value = state.value + velocity * step;
  return { value, velocity };
}

/** Runs the spring until it is close, or `limit` steps have elapsed. */
export function settleSpring(state: Spring, target: number, dt = 1 / 60, limit = 240): Spring {
  let next = state;
  for (let i = 0; i < limit; i += 1) {
    next = stepSpring(next, target, dt);
    if (Math.abs(next.value - target) < 0.001 && Math.abs(next.velocity) < 0.001) return next;
  }
  return next;
}
