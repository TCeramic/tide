export type ShellView = "home" | "playing";

type Listener = (view: ShellView) => void;

let current: ShellView = "home";
const listeners = new Set<Listener>();

function publish(next: ShellView): void {
  current = next;
  if (typeof document !== "undefined") document.documentElement.dataset.view = next;
  for (const listener of listeners) listener(next);
}

/** Cold start and the 主页 button. Playback may continue underneath. */
export function showHome(): void {
  publish("home");
}

/** Now Playing, or the user pressed play / opened a track. */
export function openNowPlaying(): void {
  publish("playing");
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
