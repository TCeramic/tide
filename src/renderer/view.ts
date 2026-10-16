export type ShellView = "home" | "playing";

type Listener = (view: ShellView) => void;

let current: ShellView = "home";
const listeners = new Set<Listener>();
let scrollReturn: { element: HTMLElement; top: number; left: number }[] = [];

function publish(next: ShellView): void {
  current = next;
  if (typeof document !== "undefined") document.documentElement.dataset.view = next;
  for (const listener of listeners) listener(next);
}

/** Cold start and the 主页 button. Playback may continue underneath. */
export function showHome(): void {
  scrollReturn = [];
  publish("home");
}

/** Now Playing, or the user pressed play / opened a track. */
export function openNowPlaying(): void {
  if (current === "playing") return;
  if (typeof document !== "undefined") scrollReturn = Array.from(document.querySelectorAll<HTMLElement>(".browse-sheet,.home-grid,.proof-host")).map(element => ({ element, top:element.scrollTop, left:element.scrollLeft }));
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

if (typeof document !== "undefined") document.documentElement.dataset.view = "home";
