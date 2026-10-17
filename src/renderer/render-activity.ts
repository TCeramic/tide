/** Main-window visual activity is independent from audio and desktop lyrics. */
let nativeActive = true;
export function isRenderingActive(): boolean { return nativeActive && !document.hidden; }
export function setRenderingActive(active: boolean): void {
  if (nativeActive === active) return;
  nativeActive = active;
  document.documentElement.dataset.renderActive = String(active);
  document.dispatchEvent(new Event("visibilitychange"));
}
