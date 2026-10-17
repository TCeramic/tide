import type { Appearance } from "../shared/contract";
export function mountNativeShell(root: HTMLElement): { sync(appearance: Appearance): void; ready():void; visualState():unknown; restoreVisualState(state:unknown):Promise<void>; destroy(): void };
export function createNativeChoiceRow(label: string, options: readonly { id: string; label: string }[], onPick: (id: string) => void): { element: HTMLElement; sync(value: string): void };
export function openDesignCatalog(shell: "lens" | "lattice"): void;
export function createNativeSearch(): { element: HTMLElement; input: HTMLInputElement; destroy(): void };

export function syncPreviewChoices(values:Record<string,string>):void;
