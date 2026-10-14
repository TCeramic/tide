import type { ShellId } from "../shared/contract";

/** Windows/Linux titleBarOverlay colors. Lens is deep water; Lattice is ink night. */
export function titleBarChrome(shell: ShellId): { color: string; symbolColor: string; height: number } {
  if (shell === "lattice") {
    return { color: "#07080b", symbolColor: "#ece7da", height: 36 };
  }
  return { color: "#102833", symbolColor: "#f3fbfb", height: 36 };
}
