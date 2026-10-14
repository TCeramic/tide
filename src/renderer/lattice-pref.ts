import { latticeEnabled, writeLatticeFlag } from "./lattice-field";

type Listener = (on: boolean) => void;

const listeners = new Set<Listener>();

export function readLattice(): boolean {
  try {
    return latticeEnabled(localStorage);
  } catch {
    return false;
  }
}

export function writeLattice(on: boolean): void {
  try {
    writeLatticeFlag(localStorage, on);
  } catch {
    // Listeners still update the current window.
  }
  for (const listener of listeners) listener(on);
}

export function onLattice(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
