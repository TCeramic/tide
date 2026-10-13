export interface RafFrame {
  now: number;
  deltaMs: number;
  elapsedMs: number;
}

/** requestAnimationFrame clock for later stage motion. Returns a stop function. */
export function createRafClock(onFrame: (frame: RafFrame) => void): () => void {
  let handle = 0;
  let last = 0;
  let origin = 0;

  const step = (now: number) => {
    if (origin === 0) origin = now;
    const deltaMs = last === 0 ? 0 : now - last;
    last = now;
    onFrame({ now, deltaMs, elapsedMs: now - origin });
    handle = requestAnimationFrame(step);
  };

  handle = requestAnimationFrame(step);
  return () => cancelAnimationFrame(handle);
}
