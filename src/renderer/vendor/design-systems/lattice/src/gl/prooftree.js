// 树 Proof tree — a theorem is a seed. Its proof grows upward: each branch reaches for a premise,
// premises branch again, until the leaves are axioms (as in a Gentzen proof tree: conclusion at the
// root, axioms at the leaves). Shared lemmas appear once; later uses are marked ↺.
// When the last leaf blooms, sap runs back down every branch into the conclusion.
import * as THREE from "three";
import { Spring, SPRINGS, reducedMotion, rng } from "../core/motion.js";

const KIND = { axiom: 0, construction: 0, definition: 1, theorem: 2 };

const BR_V = /* glsl */ `
  attribute float aB, aS, aType;
  attribute vec3 aOff;
  uniform sampler2D tBr;
  uniform float uBr, uClock, uWither, uDpr, uSize, uRate, uDone, uAlpha;
  varying float vA, vHot, vHot2;
  vec4 bd(float k) { return texture2D(tBr, vec2((k + 0.5) / 5.0, (aB + 0.5) / uBr)); }
  float h1(float x) { return fract(sin(x * 91.7 + aB * 13.1) * 43758.5453); }
  void main() {
    vec3 p0 = bd(0.0).xyz, p1 = bd(1.0).xyz, p2 = bd(2.0).xyz, p3 = bd(3.0).xyz;
    vec4 tm = bd(4.0);                                  // start, duration, highlight, _
    float g = clamp((uClock - tm.x) / tm.y, 0.0, 1.0);
    float s = aS;
    float a = 1.0;
    float tip = 0.0;
    if (aType > 0.5) {                                  // sap: runs from premise down to conclusion
      s = 1.0 - fract(aS + uClock * uRate * (0.8 + h1(aS) * 0.4));
      a = uDone * smoothstep(0.0, 0.1, s) * smoothstep(1.0, 0.85, s) * 0.9;
    } else {
      a = step(s, g);
      tip = g < 1.0 ? 1.0 - smoothstep(0.0, 0.08, g - s) : 0.0;
    }
    float it = 1.0 - s;
    vec3 p = it * it * it * p0 + 3.0 * it * it * s * p1 + 3.0 * it * s * s * p2 + s * s * s * p3;
    p += aOff * (1.0 - 0.5 * s) * (0.5 + 0.5 * g);
    if (uWither > 0.0) {                                // leaves fall
      float ft = uWither * (0.6 + h1(s) * 0.8);
      p.y -= 2.4 * ft * ft;
      p.x += sin(ft * 3.0 + h1(s * 3.1) * 6.0) * ft * 0.6;
      a *= 1.0 - smoothstep(0.4, 1.6, uWither);
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uDpr * uSize * (aType > 0.5 ? 1.4 : 1.0 + tip * 1.2) * (12.0 / -mv.z);
    vA = a * (aType > 0.5 ? 1.0 : uAlpha);
    vHot = max(tip, tm.z);
    vHot2 = aType > 0.5 ? 1.0 : 0.0;
  }
`;

const NODE_V = /* glsl */ `
  attribute float aN, aK;
  attribute vec3 aOff;
  uniform sampler2D tNd;
  uniform float uNd, uClock, uWither, uDpr, uSize, uTime, uAlpha;
  varying float vA, vHot, vHot2;
  vec4 nd(float k) { return texture2D(tNd, vec2((k + 0.5) / 2.0, (aN + 0.5) / uNd)); }
  void main() {
    vec4 P = nd(0.0), st = nd(1.0);                     // P.w = bloom time; st: hi, ref, pulse, _
    float e = clamp((uClock - P.w) / 0.55, 0.0, 1.0);
    float sc = e < 1.0 ? e * (1.0 + 0.35 * sin(e * 3.14159)) : 1.0;
    vec3 off = aOff;
    if (aK > 0.5) { float ang = atan(off.y, off.x) + uTime * 0.5; float r = length(off.xy); off = vec3(cos(ang) * r, sin(ang) * r, off.z); }
    vec3 p = P.xyz + off * sc * (1.0 + st.x * 0.4 + st.z);
    float a = step(0.001, e) * (st.y > 0.5 ? 0.45 : 1.0) * (aK > 0.5 ? 0.55 : 1.0);
    if (uWither > 0.0) { p.y -= 2.4 * uWither * uWither; a *= 1.0 - smoothstep(0.3, 1.2, uWither); }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uDpr * uSize * 1.15 * (12.0 / -mv.z);
    vA = a * min(1.0, uAlpha * 1.6);
    vHot = max(st.x, (1.0 - e) * 0.8);
    vHot2 = st.z;
  }
`;

const DOT_F = /* glsl */ `
  uniform vec3 uInk, uHot, uHot2;
  uniform float uAdditive;
  varying float vA, vHot, vHot2;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = (1.0 - smoothstep(0.3, 0.5, r)) * vA;
    if (a < 0.004) discard;
    vec3 col = mix(mix(uInk, uHot, clamp(vHot, 0.0, 1.0)), uHot2, clamp(vHot2, 0.0, 1.0) * (1.0 - clamp(vHot, 0.0, 1.0)));
    if (uAdditive > 0.5) gl_FragColor = vec4(col * a * (1.0 + vHot), 1.0);
    else gl_FragColor = vec4(col, a);
  }
`;

function shapeFor(n, rand) {
  const out = [];
  if (n.ref) { for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; out.push([Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0, 0]); } return out; }
  if (n.leaf) { // axioms bloom as five-petal rosettes
    for (let i = 0; i < 70; i++) { const a = rand() * Math.PI * 2, petal = Math.abs(Math.cos(2.5 * a)); const r = (0.05 + 0.13 * petal) * Math.sqrt(rand()); out.push([Math.cos(a) * r, Math.sin(a) * r, (rand() - 0.5) * 0.05, 0]); }
    return out;
  }
  const k = KIND[n.t.kind] ?? 2;
  if (k === 1) for (let i = 0; i < 34; i++) { const a = (i / 34) * Math.PI * 2; out.push([Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0, 0]); }
  else for (let i = 0; i < 56; i++) { const r = Math.sqrt((i + 0.5) / 56) * (n.depth === 0 ? 0.2 : 0.12), a = i * 2.39996; out.push([Math.cos(a) * r, Math.sin(a) * r, (rand() - 0.5) * 0.03, 0]); }
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = n.depth === 0 ? 0.32 : 0.2; out.push([Math.cos(a) * r, Math.sin(a) * r, 0, 1]); }
  return out;
}

class TreeInstance {
  constructor(owner, targetId) {
    const { byId } = owner;
    const rand = rng(7 + targetId.length * 31);
    // ---- unfold the DAG into a proof tree
    const nodes = [];
    const seen = new Set();
    const make = (tid, parent, depth) => {
      const t = byId.get(tid);
      const n = { t, tid, parent, depth, children: [], ref: seen.has(tid) && depth > 0, leaf: false };
      nodes.push(n);
      if (n.ref) return n;
      seen.add(tid);
      if ((t.leaf && depth > 0) || !t.deps.length) { n.leaf = true; return n; }
      for (const d of t.deps) n.children.push(make(d, n, depth + 1));
      return n;
    };
    this.root = make(targetId, null, 0);
    this.nodes = nodes;
    const leaves = (n) => (n.leafCount = n.children.length ? n.children.reduce((a, c) => a + leaves(c), 0) : 1);
    leaves(this.root);

    // ---- 3D layout: children fan around the parent's axis, rising and narrowing with depth
    this.root.pos = new THREE.Vector3(0, 0, 0);
    this.root.phi = rand() * 6.28;
    const place = (n) => {
      const m = n.children.length;
      n.children.forEach((c, i) => {
        const d = n.depth;
        const rise = 0.82 * Math.pow(0.94, d);
        const reach = (m === 1 ? 0.4 : 1.75) * Math.pow(0.8, d) * (0.45 + 0.55 * Math.sqrt(c.leafCount / n.leafCount));
        c.phi = n.phi + (m === 1 ? 0.5 : (i / m) * Math.PI * 2) + d * 0.9;
        c.pos = n.pos.clone().add(new THREE.Vector3(Math.cos(c.phi) * reach, rise * (0.85 + rand() * 0.3), Math.sin(c.phi) * reach));
        place(c);
      });
    };
    place(this.root);
    let maxY = 0;
    nodes.forEach((n) => (maxY = Math.max(maxY, n.pos.y)));
    this.height = maxY;

    // ---- growth schedule
    const branches = [];
    const sched = (n, t0) => {
      n.bloom = t0;
      n.children.forEach((c) => {
        const len = n.pos.distanceTo(c.pos);
        const dur = 0.38 + len * 0.3;
        const start = t0 + 0.05 + rand() * 0.12;
        branches.push({ from: n, to: c, start, dur, len });
        sched(c, start + dur);
      });
    };
    sched(this.root, 0.15);
    this.total = Math.max(...nodes.map((n) => n.bloom)) + 0.4;
    this.branches = branches;

    // ---- textures
    const B = Math.max(1, branches.length);
    this.brData = new Float32Array(5 * B * 4);
    branches.forEach((b, i) => {
      const a = b.from.pos, c = b.to.pos;
      const up = new THREE.Vector3(0, 1, 0);
      const p1 = a.clone().addScaledVector(up, (c.y - a.y) * 0.55);
      const p2 = c.clone().add(new THREE.Vector3((a.x - c.x) * 0.25, -(c.y - a.y) * 0.15, (a.z - c.z) * 0.25));
      [a, p1, p2, c].forEach((p, k) => this.brData.set([p.x, p.y, p.z, 1], (i * 5 + k) * 4));
      this.brData.set([b.start, b.dur, 0, 0], (i * 5 + 4) * 4);
    });
    this.tBr = new THREE.DataTexture(this.brData, 5, B, THREE.RGBAFormat, THREE.FloatType);
    this.tBr.needsUpdate = true;
    const Nn = nodes.length;
    this.ndData = new Float32Array(2 * Nn * 4);
    nodes.forEach((n, i) => { n.i = i; this.ndData.set([n.pos.x, n.pos.y, n.pos.z, n.bloom], i * 8); this.ndData.set([0, n.ref ? 1 : 0, 0, 0], i * 8 + 4); });
    this.tNd = new THREE.DataTexture(this.ndData, 2, Nn, THREE.RGBAFormat, THREE.FloatType);
    this.tNd.needsUpdate = true;
    branches.forEach((b, i) => (b.i = i));

    // ---- geometry: branch strands (thickness ∝ √leaves), sap droplets, node shapes
    const aB = [], aS = [], aT = [], aOff = [];
    branches.forEach((b, i) => {
      const strands = Math.min(14, Math.round(2 + 2.4 * Math.sqrt(b.to.leafCount)));
      const thick = 0.018 + 0.016 * Math.sqrt(b.to.leafCount);
      const dots = Math.round(22 + b.len * 30);
      for (let s = 0; s < strands; s++) {
        const o = new THREE.Vector3(rand() - 0.5, (rand() - 0.5) * 0.4, rand() - 0.5).normalize().multiplyScalar(thick * Math.sqrt(rand()) * 2);
        for (let k = 0; k < dots; k++) { aB.push(i); aS.push((k + rand() * 0.5) / dots); aT.push(0); aOff.push(o.x, o.y, o.z); }
      }
      const sap = Math.round(3 + b.len * 3);
      for (let k = 0; k < sap; k++) { aB.push(i); aS.push(rand()); aT.push(1); aOff.push(0, 0, 0); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("aB", new THREE.Float32BufferAttribute(aB, 1));
    g.setAttribute("aS", new THREE.Float32BufferAttribute(aS, 1));
    g.setAttribute("aType", new THREE.Float32BufferAttribute(aT, 1));
    g.setAttribute("aOff", new THREE.Float32BufferAttribute(aOff, 3));
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(aB.length * 3), 3));
    const aN = [], aK = [], nOff = [];
    nodes.forEach((n, i) => shapeFor(n, rand).forEach(([x, y, z, k]) => { aN.push(i); aK.push(k); nOff.push(x, y, z); }));
    const ng = new THREE.BufferGeometry();
    ng.setAttribute("aN", new THREE.Float32BufferAttribute(aN, 1));
    ng.setAttribute("aK", new THREE.Float32BufferAttribute(aK, 1));
    ng.setAttribute("aOff", new THREE.Float32BufferAttribute(nOff, 3));
    ng.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(aN.length * 3), 3));

    this.u = Object.assign({}, owner.shared, {
      tBr: { value: this.tBr }, uBr: { value: B }, tNd: { value: this.tNd }, uNd: { value: Nn },
      uClock: { value: 0 }, uWither: { value: 0 }, uDone: { value: 0 }, uRate: { value: 0.45 },
    });
    const mat = (vs) => new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: DOT_F, uniforms: this.u, transparent: true, depthWrite: false, blending: owner.blending });
    this.object = new THREE.Group();
    this.brPoints = new THREE.Points(g, mat(BR_V));
    this.ndPoints = new THREE.Points(ng, mat(NODE_V));
    [this.brPoints, this.ndPoints].forEach((p) => { p.frustumCulled = false; this.object.add(p); });
    this.hi = new Map();
    this.clock = reducedMotion() ? this.total + 1 : 0;
  }
  dispose() { this.object.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); this.tBr.dispose(); this.tNd.dispose(); }
}

export class ProofTree extends EventTarget {
  constructor({ byId, station = "tree", ground = true }) {
    super();
    this.byId = byId;
    this.station = station;
    this.object = new THREE.Group();
    this.spin = new Group3();
    this.object.add(this.spin.g);
    this.shared = {
      uDpr: { value: 1 }, uSize: { value: 2.3 }, uTime: { value: 0 }, uAlpha: { value: 0.4 },
      uInk: { value: new THREE.Color() }, uHot: { value: new THREE.Color() }, uHot2: { value: new THREE.Color() }, uAdditive: { value: 1 },
    };
    this.blending = THREE.AdditiveBlending;
    this.trees = [];
    this.hover = null;
    if (ground) this._ground();
  }

  _ground() {
    const pts = [];
    for (let r = 0.6; r < 5.4; r += 0.3) {
      const n = Math.round((r * Math.PI * 2) / 0.3);
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push(Math.cos(a) * r, -0.02, Math.sin(a) * r); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.groundMat = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.3, depthWrite: false });
    this.groundPts = new THREE.Points(g, this.groundMat);
    this.spin.g.add(this.groundPts);
  }

  setWorld(w) {
    const s = this.shared;
    s.uInk.value.set(w.ink); s.uHot.value.set(w.hot); s.uHot2.value.set(w.hot2);
    const add = w.blend === "additive";
    s.uAdditive.value = add ? 1 : 0;
    s.uAlpha.value = add ? 0.36 : 0.8;
    this.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending;
    for (const tr of this.trees) tr.object.traverse((o) => { if (o.material) { o.material.blending = this.blending; o.material.needsUpdate = true; } });
    if (this.groundMat) { this.groundMat.color.set(w.ink); this.groundMat.opacity = w.gridAlpha * 0.9; }
  }

  /** Grow the proof tree of a theorem; the current tree withers. */
  grow(id) {
    const old = this.trees.find((t) => !t.withering);
    if (old) old.withering = true;
    const tr = new TreeInstance(this, id);
    this.trees.push(tr);
    this.spin.g.add(tr.object);
    this.current = tr;
    this.dispatchEvent(new CustomEvent("grow", { detail: { id, nodes: tr.nodes, total: tr.total, height: tr.height } }));
    return tr;
  }

  live(stage) { return [].concat(this.station).some((s) => stage.near(s, 0.9)); }

  /** Rotation transition: the stand turns half a revolution while the old tree falls and the new one grows. */
  swap(id) { this.spin.turn(Math.PI); return this.grow(id); }

  /** Growth progress of the current tree, 0..1 (nodes bloomed / nodes). */
  progress() { const tr = this.current; if (!tr) return 0; let n = 0; for (const m of tr.nodes) if (tr.clock >= m.bloom) n++; return n / tr.nodes.length; }
  onPointerMove(stage) { this._pick = true; this.spin.drag(stage); }
  onPointerDown(stage) {
    if (!this.live(stage)) return false;
    if (this.hover != null) { this.dispatchEvent(new CustomEvent("pick", { detail: this.current.nodes[this.hover].tid })); return true; }
    this.spin.start(stage);
    return true;
  }
  onPointerUp() { this.spin.end(); }

  _highlight() {
    const tr = this.current;
    if (!tr) return;
    const path = new Set();
    let n = this.hover != null ? tr.nodes[this.hover] : null;
    while (n) { path.add(n); n = n.parent; }
    tr.nodes.forEach((m) => (tr.ndData[m.i * 8 + 4] = path.has(m) ? 1 : 0));
    tr.branches.forEach((b) => (tr.brData[(b.i * 5 + 4) * 4 + 2] = path.has(b.to) ? 1 : 0));
    tr.tNd.needsUpdate = tr.tBr.needsUpdate = true;
  }

  update(dt, t, stage) {
    const live = this.live(stage);
    this.object.visible = live || [].concat(this.station).some((s) => stage.near(s, 1.3));
    if (!this.object.visible) { if (this._shown) { this._shown = false; this.dispatchEvent(new CustomEvent("frame", { detail: null })); } return; }
    this._shown = true;
    this.shared.uDpr.value = stage.dpr;
    this.shared.uTime.value = t;
    this.spin.update(dt);
    for (const tr of this.trees) {
      tr.clock += dt;
      tr.u.uClock.value = tr.clock;
      tr.u.uDone.value = Math.min(1, Math.max(0, (tr.clock - tr.total) / 0.8));
      if (tr.withering) tr.u.uWither.value += dt;
    }
    this.trees = this.trees.filter((tr) => { if (tr.u.uWither.value > 1.8) { this.spin.g.remove(tr.object); tr.dispose(); return false; } return true; });
    const tr = this.current;
    if (!tr) return;
    // bloom events for labels + hover pick in screen space
    const v = new THREE.Vector3();
    const proj = tr.nodes.map((n) => {
      const p = stage.project(v.copy(n.pos).applyMatrix4(tr.object.matrixWorld));
      p.bloomed = tr.clock >= n.bloom;
      return p;
    });
    if (this._pick && live) {
      this._pick = false;
      let best = null, bd = 24 * 24;
      if (stage.pointer.inside) proj.forEach((p, i) => { const d = (p.x - stage.pointer.x) ** 2 + (p.y - stage.pointer.y) ** 2; if (p.bloomed && p.visible && d < bd) { bd = d; best = i; } });
      if (best !== this.hover) { this.hover = best; this._highlight(); this.dispatchEvent(new CustomEvent("hover", { detail: best == null ? null : tr.nodes[best] })); }
    }
    this.dispatchEvent(new CustomEvent("frame", { detail: { tree: tr, proj } }));
  }
}

/** Yaw with inertia, auto-turn when idle, drag to turn by hand. */
class Group3 {
  constructor() { this.g = new THREE.Group(); this.yaw = new Spring(0, { k: 38, c: 11 }); this.d = null; }
  turn(rad) { this.yaw.target += rad; }
  start(stage) { this.d = { x: stage.pointer.x, y0: this.yaw.target }; }
  drag(stage) { if (this.d) this.yaw.target = this.d.y0 + (stage.pointer.x - this.d.x) * 0.008; }
  end() { this.d = null; }
  update(dt) { if (!this.d && !reducedMotion()) this.yaw.target += dt * 0.12; this.g.rotation.y = this.yaw.step(dt); }
}
