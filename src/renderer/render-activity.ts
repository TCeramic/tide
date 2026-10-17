/** Main-window visual activity is independent from audio and desktop lyrics. */
let nativeActive = true;
let transitionActive = false;
export function isRenderingActive(): boolean { return nativeActive && !document.hidden && !transitionActive; }
/** Keep the new snapshot and its live canvas at the same phase until reveal ends. */
export function setThemeTransitionActive(active:boolean):void {
 if(transitionActive===active)return;transitionActive=active;
 document.documentElement.dataset.themeTransition=String(active);
 document.dispatchEvent(new Event('visibilitychange'));
}
export function setRenderingActive(active: boolean): void {
  if (nativeActive === active) return;
  nativeActive = active;
  document.documentElement.dataset.renderActive = String(active);
  document.dispatchEvent(new Event("visibilitychange"));
}
