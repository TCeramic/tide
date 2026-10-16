declare module "*design-systems/lattice/src/gl/prooftree.js" {
  import type { Object3D } from "three";
  export class ProofTree extends EventTarget {
    object: Object3D;
    shared: { uSize: { value: number } };
    trees: Array<{ dispose(): void }>;
    constructor(options: { byId: Map<string, unknown>; station?: string; ground?: boolean });
    setWorld(world: { ink: string; hot: string; hot2: string; blend: string; gridAlpha: number }): void;
    grow(id: string): unknown;
    update(dt: number, time: number, stage: unknown): void;
    onPointerMove(stage: unknown): void;
    onPointerDown(stage: unknown): boolean;
    onPointerUp(): void;
  }
}
