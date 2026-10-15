// A quiet dot grid behind a station, so every page sits on the same lattice as the hero.
import * as THREE from "three";

export class DotGrid {
  /** @param {{w:number, h:number, pitch:number, z?:number}} o plane in XY at depth z */
  constructor({ w, h, pitch, z = -4 }) {
    const pts = [];
    for (let y = -h / 2; y <= h / 2; y += pitch) for (let x = -w / 2; x <= w / 2; x += pitch) pts.push(x, y, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.mat = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, transparent: true, depthWrite: false });
    this.object = new THREE.Points(g, this.mat);
    this.object.frustumCulled = false;
  }
  setWorld(w) { this.mat.color.set(w.ink); this.mat.opacity = w.gridAlpha * 0.75; }
}
