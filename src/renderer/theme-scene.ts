const SCENE_STATE = [
  ".lyric-list",
  ".lyric-list li",
  ".lyric-word",
  ".word-mask",
  ".word-hot",
  ".lyrics-title",
  ".lyrics-artist",
  ".lyrics-source",
  ".home-current-title",
  ".home-current-artist",
  ".home-intro",
  ".home-lyric-origin",
  ".home-lyric-translation",
  ".home-section-note",
  ".home-recent-title",
  ".home-recent-artist",
  ".session-history-title",
  ".session-history-artist",
  "input",
  "select",
].join(",");

// Only text-only leaves are safe to restore with textContent. Lyrics contain
// nested karaoke masks and artist buttons, so their structure must stay intact.
const TEXT_STATE = [
  ".lyrics-title",
  ".lyrics-artist",
  ".lyrics-source",
  ".home-current-title",
  ".home-current-artist",
  ".home-intro",
  ".home-lyric-origin",
  ".home-lyric-translation",
  ".home-section-note",
  ".home-recent-title",
  ".home-recent-artist",
  ".session-history-title",
  ".session-history-artist",
  "input",
  "select",
].join(",");

const LYRIC_PAINT_STATE = ".lyric-list li,.lyric-word,.word-mask,.word-hot";

let tracked: HTMLElement[] = [];

/** Assign stable ids before the preview iframe serializes the live scene. */
export function tagThemeScene(): void {
  let id = 0;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("#app *,#lyrics *, .native-popup-layer *"));
  nodes.forEach((element) => { element.dataset.revealNode = String(++id); });
  tracked = nodes.filter((element) =>
    element.scrollTop > 0 ||
    element.scrollLeft > 0 ||
    element.matches(`.lyric-list,${LYRIC_PAINT_STATE},.desktop-scroll-surface`) ||
    element.matches(SCENE_STATE),
  );
}

export function themeSceneState() {
  return tracked.filter((element) => element.isConnected).map((element) => ({
    id: element.dataset.revealNode!,
    text: element.matches(TEXT_STATE) && !(element instanceof HTMLInputElement) && !(element instanceof HTMLSelectElement)
      ? element.textContent
      : undefined,
    top: element.scrollTop,
    left: element.scrollLeft,
    classes: element.matches(LYRIC_PAINT_STATE) ? element.className : undefined,
    style: element.matches(LYRIC_PAINT_STATE) ? element.style.cssText : undefined,
    value: element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.value : undefined,
  }));
}

export function restoreThemeScene(state: ReturnType<typeof themeSceneState>): void {
  for (const item of state) {
    const element = document.querySelector<HTMLElement>(`[data-reveal-node="${item.id}"]`);
    if (!element) continue;
    if (item.text !== undefined && element.textContent !== item.text) element.textContent = item.text;
    if (element.scrollTop !== item.top) element.scrollTop = item.top;
    if (element.scrollLeft !== item.left) element.scrollLeft = item.left;
    if (item.classes !== undefined && element.className !== item.classes) element.className = item.classes;
    if (item.style !== undefined && element.style.cssText !== item.style) element.style.cssText = item.style;
    if ((element instanceof HTMLInputElement || element instanceof HTMLSelectElement) && item.value !== undefined && element.value !== item.value) {
      element.value = item.value;
    }
  }
}
