export type ShellView = "home" | "playing";
export type ShellPage = "home" | "explore" | "library" | "proof" | "footprint" | "search";

type Listener = (view: ShellView) => void;
type PageListener = (page: ShellPage) => void;

let current: ShellView = "home";
let page: ShellPage = "home";
const listeners = new Set<Listener>();
const pageListeners = new Set<PageListener>();
let scrollReturn: { element: HTMLElement; top: number; left: number }[] = [];

/** Page navigation is separate from the home/now-playing shell transition. */
export function setShellPage(next: ShellPage): void {
  page = next;
  if (typeof document !== "undefined") document.documentElement.dataset.page = next;
  for (const listener of pageListeners) listener(next);
}

export function shellPage(): ShellPage {
  return page;
}

export function onShellPage(listener: PageListener): () => void {
  pageListeners.add(listener);
  return () => pageListeners.delete(listener);
}

function publish(next: ShellView): void {
  current = next;
  if (typeof document !== "undefined") document.documentElement.dataset.view = next;
  for (const listener of listeners) listener(next);
}

/** Cold start and the 主页 button. Playback may continue underneath. */
export function showHome(): void {
  scrollReturn = [];
  setShellPage("home");
  publish("home");
}

/** Now Playing, or the user pressed play / opened a track. */
export function openNowPlaying(): void {
  if (current === "playing") return;
  if (typeof document !== "undefined") scrollReturn = Array.from(document.querySelectorAll<HTMLElement>(".browse-sheet,.home-grid,.proof-host,.search-page,.session-history-list,.desktop-scroll-surface")).map(element => ({ element, top:element.scrollTop, left:element.scrollLeft }));
  publish("playing");
}

/** Return to the still-mounted library view, without running the homepage action. */
export function toggleNowPlaying(): void {
  if (current !== "playing") { openNowPlaying(); return; }
  publish("home");
  for (const { element, top, left } of scrollReturn) if (element.isConnected) { element.scrollTop = top; element.scrollLeft = left; }
  scrollReturn = [];
}

export function shellView(): ShellView {
  return current;
}

export function onShellView(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof document !== "undefined") {
  document.documentElement.dataset.view = "home";
  document.documentElement.dataset.page = "home";
}
