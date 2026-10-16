declare module "*design-systems/lattice/src/gl/prooftree.js" {
  import type { Object3D, Vector3, DataTexture, Points, BufferGeometry, ShaderMaterial, Group } from "three";
  interface TreeNode {tid:string;pos:Vector3;bloom:number;i:number;depth:number;parent:TreeNode|null}
  interface TreeBranch {from:TreeNode;to:TreeNode;start:number;dur:number;i:number}
  export interface ProofInstance {object:Object3D;nodes:TreeNode[];branches:TreeBranch[];clock:number;total:number;height:number;ndData:Float32Array;brData:Float32Array;tNd:DataTexture;tBr:DataTexture;u:Record<string,{value:number}>;brPoints:Points<BufferGeometry,ShaderMaterial>;ndPoints:Points<BufferGeometry,ShaderMaterial>;dispose():void}
  export class ProofTree extends EventTarget {
    object:Object3D;byId:Map<string,unknown>;current:ProofInstance;hover:number|null;
    spin:{g:Group;d:unknown;yaw:{target:number};update(dt:number):void};shared:{uSize:{value:number}};trees:ProofInstance[];
    constructor(options:{byId:Map<string,unknown>;station?:string;ground?:boolean});
    setWorld(world:{ink:string;hot:string;hot2:string;blend:string;gridAlpha:number}):void;
    grow(id:string):ProofInstance;update(dt:number,time:number,stage:unknown):void;
    onPointerMove(stage:unknown):void;onPointerDown(stage:unknown):boolean;onPointerUp():void;
  }
}
