import type { Object3D } from "three";

/** MIT Lattice proof tree. The implementation lives in prooftree.js. */
export class ProofTree extends EventTarget {
  object: Object3D;
  constructor(options: { byId: Map<string, unknown>; station?: string; ground?: boolean });
  setWorld(world: { ink: string; hot: string; hot2: string; blend: string; gridAlpha: number }): void;
  grow(id: string): unknown;
  update(dt: number, t: number, stage: unknown): void;
  onPointerMove(stage: unknown): void;
  onPointerDown(stage: unknown): boolean;
  onPointerUp(): void;
}
