// 瀑 Cascade — a dependency DAG poured as a waterfall. Premises sit above their consequences;
// every dependency is a stream of droplets that arcs off one result and falls into the next.
// Hover a result: what it needs lights upstream (hot), what it enables lights downstream (hot-2).
import * as THREE from "three";
import { Spring, SPRINGS, reducedMotion, rng } from "../core/motion.js";

const KIND = { axiom: 0, construction: 0, definition: 1, theorem: 2 };

const EDGE_V = /* glsl */ `
  attribute float aE, aS, aType;
  uniform sampler2D tEdge;
  uniform float uEdges, uTime, uRate, uDpr, uSize, uPush;
  uniform vec3 uRayO, uRayD;
  varying float vA, vHot, vHot2, vDrop;
  vec4 ed(float k) { return texture2D(tEdge, vec2((k + 0.5) / 5.0, (aE + 0.5) / uEdges)); }
  void main() {
    vec3 p0 = ed(0.0).xyz, p1 = ed(1.0).xyz, p2 = ed(2.0).xyz, p3 = ed(3.0).xyz;
    vec4 st = ed(4.0);
    float t, a;
    if (aType < 0.5) { t = aS; a = 0.3; vDrop = 0.0; }
    else {
      float speed = uRate * (0.7 + fract(aS * 13.7) * 0.6);
      float base = fract(aS + uTime * speed);
      t = base * base * 0.62 + base * 0.38;            // accelerating fall
      t = max(0.0, t - (aType - 1.0) * 0.016);          // trail points lag behind the head
      a = (1.0 - (aType - 1.0) * 0.34) * smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.92, 1.0, t));
      vDrop = 1.0;
    }
    float it = 1.0 - t;
    vec3 p = it * it * it * p0 + 3.0 * it * it * t * p1 + 3.0 * it * t * t * p2 + t * t * t * p3;
    if (aType > 0.5) p.xz += (vec2(fract(aS * 91.3), fract(aS * 57.1)) - 0.5) * 0.07 * t;
    vec3 w = p - uRayO;
    vec3 perp = w - uRayD * dot(w, uRayD);
    float d = length(perp);
    p += perp / max(d, 1e-4) * exp(-d * d / 0.1) * uPush;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float hi = max(st.r, st.g);
    gl_PointSize = uDpr * uSize * (aType < 0.5 ? 0.75 : 1.25) * (1.0 + hi * 0.5) * (12.0 / -mv.z);
    vA = a * mix(1.0, 0.2, st.b) * (1.0 + hi * 0.9);
    vHot = st.r; vHot2 = st.g;
  }
`;

const NODE_V = /* glsl */ `
  attribute float aN, aK;
  attribute vec3 aOff;
  uniform sampler2D tNode;
  uniform float uNodes, uTime, uDpr, uSize;
  varying float vA, vHot, vHot2, vDrop;
  vec4 nd(float k) { return texture2D(tNode, vec2((k + 0.5) / 2.0, (aN + 0.5) / uNodes)); }
  void main() {
    vec4 P = nd(0.0), st = nd(1.0);
    vec3 off = aOff;
    if (aK > 0.5) {
      float ang = atan(off.y, off.x) + uTime * (0.35 + st.r + st.g);
      float r = length(off.xy) * (1.0 + 0.08 * sin(uTime * 2.0 + aN));
      off = vec3(cos(ang) * r, sin(ang) * r, off.z);
    }
    vec3 p = P.xyz + off * (1.0 + st.r * 0.5 + st.g * 0.35 + st.a * 0.8);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uDpr * uSize * (aK > 0.5 ? 0.8 : 1.15) * (12.0 / -mv.z);
    vA = (aK > 0.5 ? 0.55 : 1.0) * mix(1.0, 0.22, st.b) * (1.0 + st.a);
    vHot = st.r; vHot2 = st.g; vDrop = 0.0;
  }
`;

const MIST_V = /* glsl */ `
  attribute vec4 aSeed;
  uniform vec3 uBoxMin, uBoxSize;
  uniform float uTime, uDpr, uSize;
  varying float vA, vHot, vHot2, vDrop;
  void main() {
    float fall = mod(aSeed.y * uBoxSize.y + uTime * (0.25 + aSeed.w * 0.7), uBoxSize.y);
    vec3 p = uBoxMin + vec3(aSeed.x * uBoxSize.x + sin(uTime * 0.3 + aSeed.z * 20.0) * 0.12, uBoxSize.y - fall, aSeed.z * uBoxSize.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uDpr * uSize * (0.5 + aSeed.w * 0.6) * (12.0 / -mv.z);
    vA = 0.22 * smoothstep(0.0, 2.0, fall) * smoothstep(0.0, 2.0, uBoxSize.y - fall);
    vHot = 0.0; vHot2 = 0.0; vDrop = 0.0;
  }
`;

const DOT_F = /* glsl */ `
  uniform vec3 uInk, uHot, uHot2;
  uniform float uAdditive;
  varying float vA, vHot, vHot2, vDrop;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float disc = 1.0 - smoothstep(0.3, 0.5, r);
    float a = disc * clamp(vA, 0.0, 1.6);
    if (a < 0.004) discard;
    vec3 col = mix(uInk, uHot, clamp(vHot, 0.0, 1.0));
    col = mix(col, uHot2, clamp(vHot2 * (1.0 - vHot), 0.0, 1.0));
    if (uAdditive > 0.5) gl_FragColor = vec4(col * a, 1.0);
    else gl_FragColor = vec4(col, min(1.0, a));
  }
`;

function nodeOffsets(kind, rand) {
  const out = [];
  if (kind === 0) { // foundations: a solid block of dots
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) out.push([x * 0.034, y * 0.034, (rand() - 0.5) * 0.03, 0]);
  } else if (kind === 1) { // definitions: a ring
    for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; out.push([Math.cos(a) * 0.12, Math.sin(a) * 0.12, (rand() - 0.5) * 0.02, 0]); }
  } else { // theorems: a filled disc (Fibonacci disc)
    for (let i = 0; i < 64; i++) { const r = Math.sqrt((i + 0.5) / 64) * 0.13, a = i * 2.39996; out.push([Math.cos(a) * r, Math.sin(a) * r, (rand() - 0.5) * 0.03, 0]); }
  }
  for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2; out.push([Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0, 1]); }
  return out;
}

export class Cascade extends EventTarget {
  constructor({ theorems, depth, topicOrder, stations = ["fallTop", "fallBottom"], dx = 1.6, dy = 1.3 }) {
    super();
    this.stations = stations;
    this.object = new THREE.Group();
    this.th = theorems;
    this.idx = new Map(theorems.map((t, i) => [t.id, i]));
    this.hover = null;
    this.focusId = null;
    const rand = rng(12);

    // ---- layout: layers by depth, barycentric order, topics set the depth (z) lane
    const layers = new Map();
    theorems.forEach((t) => { const d = depth.get(t.id); if (!layers.has(d)) layers.set(d, []); layers.get(d).push(t); });
    const L = Math.max(...layers.keys());
    const pos = new Map();
    [...layers.keys()].sort((a, b) => a - b).forEach((d) => {
      const row = layers.get(d);
      row.forEach((t) => { const xs = t.deps.map((x) => pos.get(x)?.x).filter((v) => v != null); t._b = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; });
      row.sort((a, b) => a._b - b._b || topicOrder.indexOf(a.topic) - topicOrder.indexOf(b.topic));
      row.forEach((t, i) => {
        const x = (i - (row.length - 1) / 2) * dx + (rand() - 0.5) * 0.25;
        const z = (topicOrder.indexOf(t.topic) - (topicOrder.length - 1) / 2) * 0.5 + (rand() - 0.5) * 0.3;
        pos.set(t.id, new THREE.Vector3(x, -d * dy, z));
      });
    });
    this.pos = pos;
    this.top = 0;
    this.bottom = -L * dy;
    this.children = new Map(theorems.map((t) => [t.id, []]));
    theorems.forEach((t) => t.deps.forEach((d) => this.children.get(d).push(t.id)));

    // ---- node texture: position + kind, state
    const Nn = theorems.length;
    this.nodeData = new Float32Array(2 * Nn * 4);
    theorems.forEach((t, i) => { const p = pos.get(t.id); this.nodeData.set([p.x, p.y, p.z, KIND[t.kind] ?? 2], i * 8); });
    this.tNode = new THREE.DataTexture(this.nodeData, 2, Nn, THREE.RGBAFormat, THREE.FloatType);
    this.tNode.needsUpdate = true;

    // ---- edge texture: 4 bezier control points + state
    this.edges = [];
    theorems.forEach((t) => t.deps.forEach((d) => this.edges.push({ from: d, to: t.id })));
    const E = this.edges.length;
    this.edgeData = new Float32Array(5 * E * 4);
    this.edges.forEach((e, i) => {
      const a = pos.get(e.from).clone().add(new THREE.Vector3(0, -0.16, 0));
      const b = pos.get(e.to).clone().add(new THREE.Vector3(0, 0.16, 0));
      const h = a.y - b.y;
      const p1 = a.clone().add(new THREE.Vector3((b.x - a.x) * 0.4, -h * 0.06, (b.z - a.z) * 0.4));
      const p2 = b.clone().add(new THREE.Vector3(0, h * 0.72, 0));
      [a, p1, p2, b].forEach((p, k) => this.edgeData.set([p.x, p.y, p.z, 1], (i * 5 + k) * 4));
    });
    this.tEdge = new THREE.DataTexture(this.edgeData, 5, E, THREE.RGBAFormat, THREE.FloatType);
    this.tEdge.needsUpdate = true;
    this.nodeState = theorems.map(() => ({ r: new Spring(0, SPRINGS.seal), g: new Spring(0, SPRINGS.seal), b: new Spring(0, SPRINGS.seal), a: 0 }));
    this.edgeState = this.edges.map(() => ({ r: new Spring(0, SPRINGS.seal), g: new Spring(0, SPRINGS.seal), b: new Spring(0, SPRINGS.seal) }));

    // ---- shared uniforms / material
    this.u = {
      tEdge: { value: this.tEdge }, tNode: { value: this.tNode }, uEdges: { value: E }, uNodes: { value: Nn },
      uTime: { value: 0 }, uRate: { value: 0.32 }, uDpr: { value: 1 }, uSize: { value: 2.6 }, uPush: { value: 0 },
      uRayO: { value: new THREE.Vector3() }, uRayD: { value: new THREE.Vector3() },
      uInk: { value: new THREE.Color() }, uHot: { value: new THREE.Color() }, uHot2: { value: new THREE.Color() }, uAdditive: { value: 1 },
      uBoxMin: { value: new THREE.Vector3() }, uBoxSize: { value: new THREE.Vector3() },
    };
    const mat = (vs) => new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: DOT_F, uniforms: this.u, transparent: true, depthWrite: false });
    this.mats = [mat(EDGE_V), mat(NODE_V), mat(MIST_V)];

    // edges: static strand dots + falling droplets (head + two trail points)
    {
      const aE = [], aS = [], aT = [];
      this.edges.forEach((e, i) => {
        const len = pos.get(e.from).distanceTo(pos.get(e.to));
        const strand = Math.round(18 + len * 14);
        for (let k = 0; k < strand; k++) { aE.push(i); aS.push(k / (strand - 1)); aT.push(0); }
        const drops = Math.round(6 + len * 3);
        for (let k = 0; k < drops; k++) { const s = rand(); for (let tr = 1; tr <= 3; tr++) { aE.push(i); aS.push(s); aT.push(tr); } }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("aE", new THREE.Float32BufferAttribute(aE, 1));
      g.setAttribute("aS", new THREE.Float32BufferAttribute(aS, 1));
      g.setAttribute("aType", new THREE.Float32BufferAttribute(aT, 1));
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(aE.length * 3), 3));
      this.edgePoints = new THREE.Points(g, this.mats[0]);
    }
    // nodes
    {
      const aN = [], aK = [], aOff = [];
      theorems.forEach((t, i) => nodeOffsets(KIND[t.kind] ?? 2, rand).forEach(([x, y, z, k]) => { aN.push(i); aK.push(k); aOff.push(x, y, z); }));
      const g = new THREE.BufferGeometry();
      g.setAttribute("aN", new THREE.Float32BufferAttribute(aN, 1));
      g.setAttribute("aK", new THREE.Float32BufferAttribute(aK, 1));
      g.setAttribute("aOff", new THREE.Float32BufferAttribute(aOff, 3));
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(aN.length * 3), 3));
      this.nodePoints = new THREE.Points(g, this.mats[1]);
    }
    // mist: the background keeps falling even between streams
    {
      const n = 5200, s = new Float32Array(n * 4);
      for (let i = 0; i < s.length; i++) s[i] = rand();
      const g = new THREE.BufferGeometry();
      g.setAttribute("aSeed", new THREE.BufferAttribute(s, 4));
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      this.mist = new THREE.Points(g, this.mats[2]);
      const w = dx * 7;
      this.u.uBoxMin.value.set(-w / 2, this.bottom - 3, -4);
      this.u.uBoxSize.value.set(w, -this.bottom + 7, 5);
    }
    [this.edgePoints, this.nodePoints, this.mist].forEach((p) => { p.frustumCulled = false; this.object.add(p); });
  }

  setWorld(w) {
    this.u.uInk.value.set(w.ink); this.u.uHot.value.set(w.hot); this.u.uHot2.value.set(w.hot2);
    const add = w.blend === "additive";
    this.u.uAdditive.value = add ? 1 : 0;
    this.mats.forEach((m) => { m.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending; m.needsUpdate = true; });
  }

  ancestors(id, set = new Set()) { for (const d of this.th[this.idx.get(id)].deps) if (!set.has(d)) { set.add(d); this.ancestors(d, set); } return set; }
  descendants(id, set = new Set()) { for (const c of this.children.get(id)) if (!set.has(c)) { set.add(c); this.descendants(c, set); } return set; }

  focus(id) { this.focusId = id; this._highlight(); }

  _highlight() {
    const id = this.hover || this.focusId;
    const up = id ? this.ancestors(id) : new Set();
    const down = id ? this.descendants(id) : new Set();
    this.th.forEach((t, i) => {
      const s = this.nodeState[i];
      const on = !id || t.id === id || up.has(t.id) || down.has(t.id);
      s.r.target = t.id === id || up.has(t.id) ? 1 : 0;
      s.g.target = down.has(t.id) ? 1 : 0;
      s.b.target = on ? 0 : 1;
    });
    this.edges.forEach((e, i) => {
      const s = this.edgeState[i];
      const upE = id && (up.has(e.from) && (up.has(e.to) || e.to === id));
      const downE = id && ((down.has(e.to)) && (down.has(e.from) || e.from === id));
      s.r.target = upE ? 1 : 0;
      s.g.target = downE ? 1 : 0;
      s.b.target = id && !upE && !downE ? 1 : 0;
    });
  }

  live(stage) { return this.stations.some((s) => stage.near(s, 1.2)); }

  onPointerMove() { this._pick = true; }
  onPointerDown(stage) {
    if (!this.live(stage) || !this.hover) return false;
    this.dispatchEvent(new CustomEvent("pick", { detail: this.hover }));
    return true;
  }

  update(dt, t, stage) {
    const live = this.live(stage);
    this.object.visible = live;
    if (!live) { if (this._shown) { this._shown = false; this.dispatchEvent(new CustomEvent("frame", { detail: null })); } return; }
    this._shown = true;
    const u = this.u;
    u.uTime.value = reducedMotion() ? 0 : t;
    u.uDpr.value = stage.dpr;
    u.uRayO.value.copy(stage.ray.o);
    u.uRayD.value.copy(stage.ray.d);
    u.uPush.value = stage.pointer.inside && !reducedMotion() ? 0.22 : 0;

    // project nodes for picking + labels
    const v = new THREE.Vector3();
    const proj = this.th.map((th) => stage.project(v.copy(this.pos.get(th.id)).applyMatrix4(this.object.matrixWorld)));
    if (this._pick) {
      this._pick = false;
      let best = null, bd = 28 * 28;
      if (stage.pointer.inside) proj.forEach((p, i) => { const d = (p.x - stage.pointer.x) ** 2 + (p.y - stage.pointer.y) ** 2; if (p.visible && d < bd) { bd = d; best = this.th[i].id; } });
      if (best !== this.hover) { this.hover = best; this._highlight(); this.dispatchEvent(new CustomEvent("hover", { detail: best })); }
    }
    // state springs → textures
    this.nodeState.forEach((s, i) => { this.nodeData.set([s.r.step(dt), s.g.step(dt), s.b.step(dt), 0], (i * 2 + 1) * 4); });
    this.edgeState.forEach((s, i) => { this.edgeData.set([s.r.step(dt), s.g.step(dt), s.b.step(dt), 0], (i * 5 + 4) * 4); });
    this.tNode.needsUpdate = true;
    this.tEdge.needsUpdate = true;
    this.dispatchEvent(new CustomEvent("frame", { detail: proj }));
  }
}
