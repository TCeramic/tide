import * as THREE from "three";
import { ProofTree, type ProofInstance } from "../vendor/design-systems/lattice/src/gl/prooftree.js";
import type { LatticeNode } from "../../core/proof-catalog";
import { latticeRecords } from "../../core/proof-catalog";
/** Adapt the pinned MIT renderer without editing vendor files. A bounded branch
 * rebuild keeps the renderer, root, camera, rotation, and existing node positions. */
export function branchGraph(tree:ProofTree, records:LatticeNode[], positions:Map<string,THREE.Vector3>,focus:string[],animate:boolean):ProofInstance {
 const previous=tree.current;
 tree.byId=latticeRecords(records);
 const next=tree.grow(records[0].id);
 const generated=new Map(next.nodes.map(n=>[n.tid,n.pos.clone()]));
 if(previous){tree.spin.g.remove(previous.object);previous.dispose();tree.trees=[next];}
 tree.hover=null;
 // Preserve the original 3D fan; existing branches retain their positions.
 for(const node of next.nodes){
  const saved=positions.get(node.tid);
  if(saved)node.pos.set(saved.x,saved.y,saved.z);
  else if(node.parent){
   const oldParent=positions.get(node.parent.tid);if(oldParent){const generatedParent=generated.get(node.parent.tid)!;node.pos.set(node.pos.x+oldParent.x-generatedParent.x,node.pos.y+oldParent.y-generatedParent.y,node.pos.z+oldParent.z-generatedParent.z);}
  }
  next.ndData.set([node.pos.x,node.pos.y,node.pos.z,saved||!animate?-1:.45],node.i*8);
  node.bloom=saved||!animate?-1:.45;
  const dim=focus.length>1&&!focus.includes(node.tid)&&!node.tid.startsWith(focus.at(-1)!+'/');
  next.ndData[node.i*8+5]=dim?1:0;
  positions.set(node.tid,node.pos.clone());
 }
 for(const b of next.branches){
  const a=b.from.pos,z=b.to.pos,at=b.i*20,exists=Boolean(previous?.nodes.some(n=>n.tid===b.to.tid));
  const p1=a.clone().set(a.x,a.y+.55,a.z),p2=z.clone().set(z.x,z.y-.15,z.z);
  [a,p1,p2,z].forEach((v,k)=>next.brData.set([v.x,v.y,v.z,1],at+k*4));
  const dim=focus.length>1&&!focus.includes(b.to.tid)&&!b.to.tid.startsWith(focus.at(-1)!+'/');
  next.brData.set([exists||!animate?-1:0,.45,0,dim?1:0],at+16);
 }
 next.clock=0;next.total=.9;next.height=Math.max(...next.nodes.map(n=>n.pos.y));
 // Use unused texture channels to dim branches and reverse only removed branches.
 const branch=next.brPoints.material,node=next.ndPoints.material;
 next.u.uRetract={value:0};
 branch.uniforms.uRetract=next.u.uRetract;node.uniforms.uRetract=next.u.uRetract;
 branch.vertexShader=branch.vertexShader.replace('uniform float uBr,','uniform float uRetract; uniform float uBr,').replace('float s = aS;','g *= 1.0 - uRetract * step(1.5,tm.w); float s = aS;').replace('vA = a * (aType > 0.5 ? 1.0 : uAlpha);','vA = a * (aType > 0.5 ? 1.0 : uAlpha) * (tm.w > .5 && tm.w < 1.5 ? .22 : 1.0);');
 node.vertexShader=node.vertexShader.replace('uniform float uNd,','uniform float uRetract; uniform float uNd,').replace('float sc = e <','e *= 1.0-uRetract*step(1.5,st.w); float sc = e <');
 branch.needsUpdate=node.needsUpdate=true;next.tNd.needsUpdate=next.tBr.needsUpdate=true;
 return next;
}
export function retractBranches(instance:ProofInstance,keep:Set<string>,amount:number){
 for(const n of instance.nodes)instance.ndData[n.i*8+7]=keep.has(n.tid)?0:2;
 for(const b of instance.branches)if(!keep.has(b.to.tid))instance.brData[b.i*20+19]=2;
 instance.u.uRetract.value=amount;instance.tNd.needsUpdate=instance.tBr.needsUpdate=true;
}
