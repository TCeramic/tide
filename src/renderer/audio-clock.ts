let current: (() => { id: string | null; positionMs: number; playing: boolean }) | null = null;
const listeners = new Set<() => void>();
export function onAudioClockChange(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}

export function bindAudioClock(audio: HTMLAudioElement, id: () => string | null): () => void {
  const read = () => ({ id: id(), positionMs: audio.currentTime * 1000, playing: !audio.paused && !audio.ended });
  current = read;
  const notify = () => { for (const listener of listeners) listener(); };
  const events = ["play","playing","pause","seeking","seeked","timeupdate","waiting","ended","loadedmetadata"];
  for (const event of events) audio.addEventListener(event, notify);
  return () => {
    for (const event of events) audio.removeEventListener(event, notify);
    if (current === read) { current = null; notify(); }
  };
}

export function readAudioClock(id: string | null) {
  const state = current?.();
  return id && state?.id === id && Number.isFinite(state.positionMs) ? state : null;
}
