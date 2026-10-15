import type { ShellId } from "../shared/contract";

/**
 * Windows and Linux titleBarOverlay.
 * Lens follows the original aurora / ocean scene palette.
 * Lattice uses the ink ground (`#07080b`) and bone symbols (`#ece7da`).
 */
export function titleBarChrome(shell: ShellId, theme = "tide"): { color: string; symbolColor: string; height: number } {
  if (shell === "lattice") {
    return { color: "#07080b", symbolColor: "#ece7da", height: 36 };
  }
  return theme === "dusk"
    ? { color: "#326975", symbolColor: "#f2f7fc", height: 36 }
    : { color: "#d3e8e3", symbolColor: "#22252b", height: 36 };
}

/** Window fill behind the overlay. Lens is the ocean body; Lattice is ink. */
export function windowBackground(shell: ShellId, theme = "tide"): string {
  return shell === "lattice" ? "#07080b" : theme === "dusk" ? "#193f64" : "#d3e8e3";
}
