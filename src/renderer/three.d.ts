/** The subset of Three used by the proof-tree host. The library itself is three@0.186.1. */
declare module "three" {
  export class Object3D {
    add(object: Object3D): this;
  }

  export class Scene extends Object3D {}

  export class Camera extends Object3D {}

  export class Vector3 {
    x: number;
    y: number;
    z: number;
    clone(): Vector3;
    project(camera: Camera): Vector3;
  }

  export class PerspectiveCamera extends Camera {
    aspect: number;
    position: Vector3 & { set(x: number, y: number, z: number): this };
    constructor(fov: number, aspect: number, near: number, far: number);
    lookAt(x: number, y: number, z: number): void;
    updateProjectionMatrix(): void;
  }

  export class WebGLRenderer {
    constructor(options?: {
      canvas?: HTMLCanvasElement;
      alpha?: boolean;
      antialias?: boolean;
      powerPreference?: string;
    });
    setClearColor(color: number, alpha: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    dispose(): void;
    render(scene: Scene, camera: Camera): void;
  }
}
