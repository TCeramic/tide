import { isRenderingActive } from "./render-activity";
export interface RafFrame { now: number; deltaMs: number; elapsedMs: number }
export function createRafClock(onFrame: (frame: RafFrame) => void): () => void {
  let handle = 0, last = 0, elapsed = 0, stopped = false;
  const step = (now: number) => {
    handle = 0;
    if (stopped || !isRenderingActive()) { last = 0; return; }
    const deltaMs = last ? Math.min(100, now - last) : 0; last = now; elapsed += deltaMs;
    onFrame({ now, deltaMs, elapsedMs: elapsed }); handle = requestAnimationFrame(step);
  };
  const wake = () => { cancelAnimationFrame(handle); handle = 0; last = 0; if (!stopped && isRenderingActive()) handle = requestAnimationFrame(step); };
  document.addEventListener("visibilitychange", wake); wake();
  return () => { stopped = true; cancelAnimationFrame(handle); document.removeEventListener("visibilitychange", wake); };
}
