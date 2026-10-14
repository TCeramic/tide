import type { ShellId } from "../shared/contract";

/**
 * Windows and Linux titleBarOverlay.
 * Lens uses the ocean-scene cap from design-systems (`#2a7d94`).
 * Lattice uses the ink ground (`#07080b`) and bone symbols (`#ece7da`).
 */
export function titleBarChrome(shell: ShellId): { color: string; symbolColor: string; height: number } {
  if (shell === "lattice") {
    return { color: "#07080b", symbolColor: "#ece7da", height: 36 };
  }
  return { color: "#2a7d94", symbolColor: "#f7fbff", height: 36 };
}

/** Window fill behind the overlay. Lens is the ocean body; Lattice is ink. */
export function windowBackground(shell: ShellId): string {
  return shell === "lattice" ? "#07080b" : "#183c67";
}
