// 点 Field — the signature: tens of thousands of points simulated on the GPU.
// Each point is bound to a target in the current set by a spring. A morph releases points
// one by one (in a sweep) into an ABC flow — a divergence-free solution of the Euler equations —
// before the new set pulls them in, so transitions pour instead of teleporting.
// The pointer is a field (push + swirl + wake); holding melts points around it; a click is a shockwave.
import * as THREE from "three";
import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js";
import { Spring, SPRINGS, reducedMotion, rng } from "../core/motion.js";

const COMMON = /* glsl */ `
  uniform sampler2D tTarget, tPrev, tSeed;
  uniform mat4 uSetMat, uPrevMat;
  uniform float uTime, uMorphStart, uMorphDur;
  uniform vec3 uSweepAxis;
  uniform float uSweepSpan;
  float releaseAt(vec4 seed, vec3 tgt) {
    float sweep = clamp(dot(tgt, uSweepAxis) / uSweepSpan * 0.5 + 0.5, 0.0, 1.0);
    return uMorphStart + (seed.x * 0.45 + sweep * 0.55) * uMorphDur;
  }
`;

const VEL = /* glsl */ `
  ${COMMON}
  uniform float uDelta, uSpring, uDamp, uFlow, uTransitFlow, uFlowScale, uJitter;
  uniform vec3 uRayO, uRayD, uPtrVel, uHeatC;
  uniform float uPtrR, uPush, uSwirl, uDrag, uHeat, uHeatR, uPour;
  uniform vec4 uShock;
  uniform float uShockAmp;

  vec3 abc(vec3 p, float t) {
    return vec3(sin(p.z + t * 0.13) + 0.43 * cos(p.y - t * 0.11),
                0.7 * sin(p.x + t * 0.07) + cos(p.z + t * 0.05),
                0.43 * sin(p.y - t * 0.09) + 0.7 * cos(p.x + t * 0.12));
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 P = texture2D(texturePosition, uv);
    vec4 V = texture2D(textureVelocity, uv);
    vec4 T = texture2D(tTarget, uv);
    vec4 Tp = texture2D(tPrev, uv);
    vec4 S = texture2D(tSeed, uv);
    // only shape points (w > 0.5) ride the set's rotation; grid and hidden points stay on the page
    vec3 tgt = T.w > 0.5 ? (uSetMat * vec4(T.xyz, 1.0)).xyz : T.xyz;
    vec3 prv = Tp.w > 0.5 ? (uPrevMat * vec4(Tp.xyz, 1.0)).xyz : Tp.xyz;

    float since = uTime - releaseAt(S, T.xyz);
    bool released = since >= 0.0;
    vec3 goal = released ? tgt : prv;
    float k = released ? uSpring * smoothstep(0.05, 0.75, since) : uSpring;
    float flow = uFlow + (released ? uTransitFlow * (1.0 - smoothstep(0.0, 1.0, since)) : 0.0);

    // heat: points near a held pointer lose their binding and swirl
    float hd = length(P.xyz - uHeatC);
    float hf = uHeat * exp(-(hd * hd) / (uHeatR * uHeatR));
    k *= 1.0 - 0.96 * hf;
    flow += hf * 5.0;
    // pour: scrolling down drains the page into the waterfall below; scrolling back re-forms it
    k *= 1.0 - 0.94 * uPour;
    flow += uPour * 1.2;

    vec3 acc = (goal - P.xyz) * k;
    acc += abc(P.xyz * uFlowScale + S.yzw * 6.2831, uTime) * flow;
    acc += cross(vec3(0.0, 0.0, 1.0), P.xyz - uHeatC) * hf * 4.0;
    acc += vec3(sin(uTime * 1.7 + S.y * 40.0), cos(uTime * 1.3 + S.z * 40.0), sin(uTime * 1.1 + S.w * 40.0)) * uJitter;

    // pointer field around the camera ray: push, swirl, and drag along with the pointer's motion
    vec3 w = P.xyz - uRayO;
    vec3 perp = w - uRayD * dot(w, uRayD);
    float d = length(perp);
    float f = exp(-(d * d) / (uPtrR * uPtrR));
    vec3 n = perp / max(d, 1e-4);
    acc += n * f * uPush + cross(uRayD, n) * f * uSwirl + uPtrVel * f * uDrag;

    // shockwave: an expanding ring impulse
    float st = uTime - uShock.w;
    if (st > 0.0 && st < 1.6) {
      vec3 ds = P.xyz - uShock.xyz;
      float dd = length(ds);
      float ring = st * 3.0;
      acc += (ds / max(dd, 1e-3)) * exp(-pow((dd - ring) / 0.22, 2.0)) * uShockAmp * (1.0 - st / 1.6);
    }

    acc.y -= uPour * (5.0 + S.x * 9.0);
    vec3 v = V.xyz + acc * uDelta;
    v *= exp(-uDamp * uDelta);
    gl_FragColor = vec4(v, hf);
  }
`;

const POS = /* glsl */ `
  ${COMMON}
  uniform float uDelta;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 P = texture2D(texturePosition, uv);
    vec4 V = texture2D(textureVelocity, uv);
    vec4 T = texture2D(tTarget, uv);
    vec4 Tp = texture2D(tPrev, uv);
    vec4 S = texture2D(tSeed, uv);
    bool released = uTime >= releaseAt(S, T.xyz);
    float wGoal = released ? T.w : Tp.w;
    P.xyz += V.xyz * uDelta;
    P.w += (wGoal - P.w) * min(1.0, uDelta * (released ? 3.0 : 6.0));
    gl_FragColor = P;
  }
`;

const DRAW_V = /* glsl */ `
  attribute vec2 ref;
  uniform sampler2D tPos, tVel;
  uniform float uSize, uLit, uDpr, uGain;
  varying float vA, vHeat, vLit;
  void main() {
    vec4 P = texture2D(tPos, ref);
    vec4 V = texture2D(tVel, ref);
    vec4 mv = modelViewMatrix * vec4(P.xyz, 1.0);
    gl_Position = projectionMatrix * mv;
    float spd = length(V.xyz);
    vLit = smoothstep(0.45, 1.0, P.w);
    float grid = smoothstep(0.05, 0.3, P.w) * (1.0 - vLit);
    gl_PointSize = uDpr * (uSize * mix(1.0, uLit, vLit) + min(spd, 4.0) * 0.18) * (10.0 / -mv.z);
    vA = clamp(P.w, 0.0, 1.0) * uGain;
    vHeat = clamp((spd - 0.6) * 0.16 + V.w * 1.5, 0.0, 1.0);
  }
`;

const DRAW_F = /* glsl */ `
  uniform vec3 uInk, uHot;
  uniform float uAdditive, uGridAlpha, uLitAlpha;
  varying float vA, vHeat, vLit;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r = length(q);
    float disc = 1.0 - smoothstep(0.34, 0.5, r);
    if (disc <= 0.0 || vA < 0.01) discard;
    vec3 col = mix(uInk, uHot, vHeat);
    float a = disc * mix(uGridAlpha / 0.35 * min(vA, 0.35), vA * uLitAlpha, vLit);
    if (uAdditive > 0.5) gl_FragColor = vec4(col * a * (1.0 + vHeat), 1.0);
    else gl_FragColor = vec4(col, a);
  }
`;

// paper world: each point casts a soft shadow onto the page (z = 0), offset by its height
const SHADOW_V = /* glsl */ `
  attribute vec2 ref;
  uniform sampler2D tPos;
  uniform float uSize, uDpr;
  uniform vec2 uLight;
  varying float vA;
  void main() {
    vec4 P = texture2D(tPos, ref);
    float h = max(0.0, P.z);
    vec3 p = vec3(P.x + h * uLight.x, P.y + h * uLight.y, -0.002);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uDpr * uSize * (1.6 + h * 5.0) * (10.0 / -mv.z);
    vA = smoothstep(0.45, 1.0, P.w) * 0.16 / (1.0 + h * 3.0);
  }
`;
const SHADOW_F = /* glsl */ `
  varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = (1.0 - smoothstep(0.0, 0.5, r)) * vA;
    if (a < 0.003) discard;
    gl_FragColor = vec4(0.07, 0.07, 0.1, a);
  }
`;

export class Field extends EventTarget {
  constructor(stage, { size, cols } = {}) {
    super();
    this.stage = stage;
    const mobile = stage.mobile;
    this.S = size || (mobile ? 160 : 256);
    this.N = this.S * this.S;
    this.colsOverride = cols;
    this.object = new THREE.Group();
    this.distance = 10;
    this.setMat = new THREE.Matrix4();
    this.prevMat = new THREE.Matrix4();
    this.spin = { yaw: new Spring(0, SPRINGS.ring), pitch: new Spring(0.35, SPRINGS.ring), auto: 0.12 };
    this.current = null;
    this.heat = 0;
    this.holdT = 0;
    this.lastHit = new THREE.Vector3();
    this._ptrPrev = null;
    this.mode3d = false;

    this._initGpu(stage.renderer);
    this._initDraw();
  }

  _dataTex(data) {
    const t = new THREE.DataTexture(data, this.S, this.S, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }

  _initGpu(renderer) {
    const gpu = (this.gpu = new GPUComputationRenderer(this.S, this.S, renderer));
    if (!renderer.extensions.has("EXT_color_buffer_float")) gpu.setDataType(THREE.HalfFloatType);
    const p0 = gpu.createTexture(), v0 = gpu.createTexture();
    const rand = rng(1);
    for (let i = 0; i < this.N; i++) p0.image.data.set([(rand() - 0.5) * 12, (rand() - 0.5) * 8, (rand() - 0.5) * 4, 0], i * 4);
    const seeds = new Float32Array(this.N * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
    this.tSeed = this._dataTex(seeds);
    this.tTarget = this._dataTex(new Float32Array(this.N * 4));
    this.tPrev = this._dataTex(new Float32Array(this.N * 4));

    this.vel = gpu.addVariable("textureVelocity", VEL, v0);
    this.pos = gpu.addVariable("texturePosition", POS, p0);
    gpu.setVariableDependencies(this.vel, [this.pos, this.vel]);
    gpu.setVariableDependencies(this.pos, [this.pos, this.vel]);
    const common = {
      tTarget: { value: this.tTarget }, tPrev: { value: this.tPrev }, tSeed: { value: this.tSeed },
      uSetMat: { value: this.setMat }, uPrevMat: { value: this.prevMat },
      uTime: { value: 0 }, uMorphStart: { value: -10 }, uMorphDur: { value: 1.4 },
      uSweepAxis: { value: new THREE.Vector3(1, 0, 0) }, uSweepSpan: { value: 8 }, uDelta: { value: 0.016 },
    };
    this.u = Object.assign(this.vel.material.uniforms, common, {
      uSpring: { value: 38 }, uDamp: { value: 6.5 }, uFlow: { value: 0.0 }, uTransitFlow: { value: 9 }, uFlowScale: { value: 1.3 }, uJitter: { value: 0.35 },
      uRayO: { value: new THREE.Vector3() }, uRayD: { value: new THREE.Vector3(0, 0, -1) }, uPtrVel: { value: new THREE.Vector3() },
      uPtrR: { value: 0.55 }, uPush: { value: 16 }, uSwirl: { value: 7 }, uDrag: { value: 9 },
      uHeatC: { value: new THREE.Vector3(0, 0, 99) }, uHeat: { value: 0 }, uHeatR: { value: 1.1 },
      uShock: { value: new THREE.Vector4(0, 0, 0, -10) }, uShockAmp: { value: 55 }, uPour: { value: 0 },
    });
    // the position pass shares the timing uniforms by reference
    Object.assign(this.pos.material.uniforms, common);
    const err = gpu.init();
    if (err) throw new Error(err);
  }

  _initDraw() {
    const g = new THREE.BufferGeometry();
    const ref = new Float32Array(this.N * 2);
    for (let i = 0; i < this.N; i++) ref.set([((i % this.S) + 0.5) / this.S, (Math.floor(i / this.S) + 0.5) / this.S], i * 2);
    g.setAttribute("ref", new THREE.BufferAttribute(ref, 2));
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.N * 3), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    this.du = {
      tPos: { value: null }, tVel: { value: null }, uSize: { value: 2.1 }, uLit: { value: 2.0 }, uDpr: { value: 1 }, uGain: { value: 1 },
      uInk: { value: new THREE.Color() }, uHot: { value: new THREE.Color() }, uAdditive: { value: 1 }, uGridAlpha: { value: 0.3 }, uLitAlpha: { value: 0.5 },
    };
    this.drawMat = new THREE.ShaderMaterial({ vertexShader: DRAW_V, fragmentShader: DRAW_F, uniforms: this.du, transparent: true, depthWrite: false });
    this.points = new THREE.Points(g, this.drawMat);
    this.points.frustumCulled = false;
    this.su = { tPos: this.du.tPos, uSize: this.du.uSize, uDpr: this.du.uDpr, uLight: { value: new THREE.Vector2(0.22, -0.3) } };
    this.shadow = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: SHADOW_V, fragmentShader: SHADOW_F, uniforms: this.su, transparent: true, depthWrite: false }));
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = -1;
    this.object.add(this.shadow, this.points);
  }

  setWorld(w) {
    this.world = w;
    this.du.uInk.value.set(w.ink);
    this.du.uHot.value.set(w.hot);
    const add = w.blend === "additive";
    this.du.uAdditive.value = add ? 1 : 0;
    this.drawMat.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.drawMat.needsUpdate = true;
    this.du.uGridAlpha.value = w.gridAlpha;
    this.du.uGain.value = w.dotGain;
    this.shadow.visible = !!w.shadow;
  }

  /** Build the lattice for the current viewport. */
  onResize(stage) {
    const { w, h } = stage.frustumAt(this.distance);
    // density follows the current viewport, not the one at load
    const cols = stage.mobile ? 46 : Math.round((this.colsOverride || 150) * Math.min(1, Math.max(0.7, w / 8.6)));
    const { Lattice } = this._sets;
    this.lattice = new Lattice(this.N, w * 1.02, h * 1.02, cols);
    this.pitchPx = stage.w / cols;
    this.du.uSize.value = stage.mobile ? 2.4 : 2.1;
    this.du.uDpr.value = stage.dpr;
    this.dispatchEvent(new CustomEvent("lattice", { detail: this.lattice }));
    if (this.current) this.show(this.current.build(this.lattice), { ...this.current.opts, instant: false });
  }

  /** Called once the set module is available (kept separate so sets can be tree-shaken). */
  useSets(mod) { this._sets = mod; }

  /**
   * Morph to a new set.
   * @param {Float32Array} data N×4 targets
   * @param {{ is3d?:boolean, sweep?:number[], dur?:number, lit?:number, flow?:number, instant?:boolean, build?:Function }} opts
   */
  show(data, opts = {}) {
    // previous targets become the "hold" set until each point is released
    // first set: nothing to hold on to yet, so points condense straight from the dust
    this.tPrev.image.data.set(this._primed ? this.tTarget.image.data : data);
    this._primed = true;
    this.tPrev.needsUpdate = true;
    this.prevMat.copy(this.setMat);
    this.tTarget.image.data.set(data);
    this.tTarget.needsUpdate = true;
    this.mode3d = !!opts.is3d;
    if (!this.mode3d) this.setMat.identity();
    const ax = opts.sweep || [1, 0, 0];
    this.u.uSweepAxis.value.set(ax[0], ax[1], ax[2]).normalize();
    this.u.uSweepSpan.value = opts.span || 9;
    this.u.uMorphDur.value = reducedMotion() || opts.instant ? 0.001 : (opts.dur ?? 1.5);
    this.u.uMorphStart.value = this.u.uTime.value;
    this.u.uTransitFlow.value = opts.flow ?? 3;
    this.litTarget = opts.lit ?? 2.0;
    this.alphaTarget = opts.alpha ?? 0.5;
  }

  /** Remember how to rebuild a set on resize. */
  keep(build, opts) { this.current = { build, opts }; this.show(build(this.lattice), opts); }

  shock(point, amp = 55) {
    this.u.uShock.value.set(point.x, point.y, point.z, this.u.uTime.value);
    this.u.uShockAmp.value = amp;
  }

  _hitPlane(stage, out) {
    // intersection of the pointer ray with z = 0 (or the set's centre plane in 3D)
    const o = stage.ray.o, d = stage.ray.d;
    const z = this.mode3d ? this.planeZ || 0 : 0;
    const t = Math.abs(d.z) > 1e-4 ? (z - o.z) / d.z : 0;
    return out.copy(o).addScaledVector(d, t);
  }

  onPointerDown(stage) {
    if (!this.active(stage)) return false;
    this.holding = true;
    this.holdT = 0;
    this._hitPlane(stage, this.lastHit);
    this.dragStart = { x: stage.pointer.x, y: stage.pointer.y, yaw: this.spin.yaw.target, pitch: this.spin.pitch.target };
    this.dispatchEvent(new CustomEvent("press"));
    return true;
  }

  onPointerUp(stage) {
    if (!this.holding) return;
    this.holding = false;
    const moved = stage.pointer.moved;
    const melted = this.heat > 0.55;
    if (!melted && moved < 8) { this.shock(this._hitPlane(stage, new THREE.Vector3())); this.dispatchEvent(new CustomEvent("tap")); }
    this.dispatchEvent(new CustomEvent("release", { detail: { melted } }));
    this.holdT = 0;
  }

  onPointerMove(stage) {
    if (this.holding && this.mode3d && this.dragStart) {
      this.spin.yaw.target = this.dragStart.yaw + (stage.pointer.x - this.dragStart.x) * 0.008;
      this.spin.pitch.target = Math.max(-0.9, Math.min(1.2, this.dragStart.pitch + (stage.pointer.y - this.dragStart.y) * 0.006));
    }
  }

  active(stage) { return stage.visible && (stage.near("hero", 0.6) || stage.near("close", 0.6)); }

  update(dt, t, stage) {
    const on = stage.near("hero", 1.1) || stage.near("close", 1.1);
    this.object.visible = on;
    if (!on) return;
    const u = this.u;
    u.uTime.value = t;
    u.uDelta.value = Math.min(dt, 1 / 30);
    const c = stage.cam.value;
    // the hero first scrolls away with the page (Stage follow); once the camera leaves, its points rain down after it
    const hold = stage.stations[0]?.hold || 0;
    u.uPour.value = reducedMotion() || c > 1.2 ? 0 : Math.min(1, Math.max(0, (c - hold) / 0.3));

    // pointer
    const hit = this._hitPlane(stage, new THREE.Vector3());
    if (this._ptrPrev && stage.pointer.inside) {
      const v = hit.clone().sub(this._ptrPrev).divideScalar(Math.max(dt, 1 / 120));
      u.uPtrVel.value.lerp(v.clampLength(0, 6), 0.5);
    } else u.uPtrVel.value.set(0, 0, 0);
    this._ptrPrev = hit;
    u.uRayO.value.copy(stage.ray.o);
    u.uRayD.value.copy(stage.ray.d);
    const live = stage.pointer.inside && this.active(stage) && !reducedMotion();
    u.uPush.value = live ? (this.mode3d ? 10 : 16) : 0;
    u.uSwirl.value = live ? 7 : 0;
    u.uDrag.value = live ? 9 : 0;

    // hold to melt
    if (this.holding && stage.pointer.moved < 8) this.holdT += dt;
    const want = this.holding && this.holdT > 0.22 ? Math.min(1, (this.holdT - 0.22) / 0.9) : 0;
    this.heat += (want - this.heat) * Math.min(1, dt * (want > this.heat ? 5 : 3));
    u.uHeat.value = this.heat;
    u.uHeatC.value.copy(this.holding ? hit : this.lastHit);
    if (this.holding) this.lastHit.copy(hit);
    this.dispatchEvent(new CustomEvent("heat", { detail: this.heat }));

    // 3D sets turn slowly; dragging turns them by hand
    if (this.mode3d) {
      if (!this.holding && !reducedMotion()) this.spin.yaw.target += dt * this.spin.auto;
      const yaw = this.spin.yaw.step(dt), pitch = this.spin.pitch.step(dt);
      this.setMat.makeRotationFromEuler(new THREE.Euler(pitch * 0.5, yaw, 0, "YXZ"));
      this.setMat.setPosition(this.setOffset || new THREE.Vector3(0, 0, 0.8));
    }

    this.du.uLit.value += ((this.litTarget || 2) - this.du.uLit.value) * Math.min(1, dt * 3);
    // falling points are faint, so the rain never competes with text
    this.du.uGain.value = (this.world?.dotGain ?? 1) * (1 - 0.6 * u.uPour.value);
    const ag = this.alphaTarget * (this.world?.blend === "additive" ? 1 : 1.8);
    this.du.uLitAlpha.value += (ag - this.du.uLitAlpha.value) * Math.min(1, dt * 3);
    this.gpu.compute();
    this.du.tPos.value = this.gpu.getCurrentRenderTarget(this.pos).texture;
    this.du.tVel.value = this.gpu.getCurrentRenderTarget(this.vel).texture;
  }
}
