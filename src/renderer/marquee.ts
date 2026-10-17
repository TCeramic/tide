import { isRenderingActive } from "./render-activity";
/** Keep the metadata's layout fixed; only the clipped text moves. */
export function mountMarquee(host: HTMLElement): { set: (text: string) => void; destroy: () => void } {
  const text = document.createElement("span");
  text.className = "track-title-text";
  host.append(text);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let animation: Animation | null = null, frame = 0, value = "";
  const measure = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0; animation?.cancel(); animation = null;
      const distance = Math.max(0, text.scrollWidth - host.clientWidth);
      host.classList.toggle("is-overflowing", distance > 2);
      if (distance <= 2 || reduced.matches || !isRenderingActive()) return;
      animation = text.animate([
        { transform: "translateX(0)", offset: 0 },
        { transform: "translateX(0)", offset: 0.2 },
        { transform: `translateX(-${distance}px)`, offset: 0.75 },
        { transform: `translateX(-${distance}px)`, offset: 0.9 },
        { transform: "translateX(0)", offset: 1 },
      ], { duration: Math.max(10000, distance / 32 * 1000 + 4000), delay: 3000, iterations: Infinity, easing: "linear" });
    });
  };
  const observer = new ResizeObserver(measure); observer.observe(host);
  reduced.addEventListener("change", measure);
  document.addEventListener("visibilitychange", measure);
  void document.fonts.ready.then(measure);
  return {
    set(next) { if (value === next) return; value = next; text.textContent = next; host.title = next; host.setAttribute("aria-label", next); measure(); },
    destroy() { observer.disconnect(); reduced.removeEventListener("change", measure); document.removeEventListener("visibilitychange", measure); cancelAnimationFrame(frame); animation?.cancel(); },
  };
}
