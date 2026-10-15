// 场 Stage — one WebGL context for the page. Scroll positions map to camera stations; between
// stations the camera glides (optionally through a waypoint). Actors are updated only when useful.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { clock, clamp, lerp, reducedMotion, Spring, SPRINGS } from "../core/motion.js";

const smooth = (f) => f * f * (3 - 2 * f);
const val = (x) => (typeof x === "function" ? x() : x); // stations may compute their camera per frame

export class Stage {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ id:string, el:string, anchor?:number, pos:number[], look:number[], offset?:number[], offsetMobile?:number[], via?:{pos:number[],look:number[]} }[]} stations
   * @param {object} world entry of WORLDS
   */
  constructor(canvas, stations, world) {
    this.canvas = canvas;
    this.stations = stations;
    this.mobile = innerWidth <= 760;
    this.maxDpr = Math.min(devicePixelRatio || 1, this.mobile ? 1.5 : 2);
    this.dpr = Math.min(this.maxDpr, 1.5);

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: /[?&]capture/.test(location.search) }));
    r.setPixelRatio(this.dpr);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 400);
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.setWorld(world);

    this.actors = new Set();
    this.pointer = { x: -1e4, y: -1e4, ndc: new THREE.Vector2(0, 0), inside: false, down: false, moved: 0 };
    this.raycaster = new THREE.Raycaster();
    this.progress = 0;
    this.cam = new Spring(0, { k: 42, c: 13 });
    this.par = { x: new Spring(0, SPRINGS.paper), y: new Spring(0, SPRINGS.paper) };
    this.visible = true;
    this._ft = [];
    this.ray = { o: new THREE.Vector3(), d: new THREE.Vector3(0, 0, -1) };

    this._bind();
    this.resize();
    clock.add((dt, t) => this._frame(dt, t));
  }

  setWorld(world) {
    this.world = world;
    this.scene.background = new THREE.Color(world.bg);
    this.bloom.enabled = world.bloom > 0;
    this.bloom.strength = world.bloom;
    for (const a of this.actors || []) a.setWorld?.(world);
  }

  add(actor) { this.actors.add(actor); if (actor.object) this.scene.add(actor.object); actor.setWorld?.(this.world); return actor; }

  _bind() {
    const ndc = (e) => {
      this.pointer.x = e.clientX; this.pointer.y = e.clientY;
      this.pointer.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      this.pointer.inside = true;
    };
    addEventListener("pointermove", (e) => { ndc(e); if (this.pointer.down) this.pointer.moved += Math.abs(e.movementX) + Math.abs(e.movementY); for (const a of this.actors) a.onPointerMove?.(this, e); }, { passive: true });
    addEventListener("pointerdown", (e) => {
      // controls and readable text keep their own behaviour (clicking, selecting text)
      if (e.target.closest?.("a,button,input,select,textarea,label,summary,p,h1,h2,h3,h4,li,.lx-panel,[data-no-stage]")) return;
      ndc(e); this.pointer.down = true; this.pointer.moved = 0;
      let claimed = false;
      for (const a of this.actors) if (a.onPointerDown?.(this, e)) { claimed = true; break; }
      // a drag that belongs to the field must not start a text selection
      if (claimed) e.preventDefault();
    });
    const up = (e) => { if (!this.pointer.down) return; this.pointer.down = false; for (const a of this.actors) a.onPointerUp?.(this, e); };
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
    document.addEventListener("pointerleave", () => { this.pointer.inside = false; });
    addEventListener("resize", () => this.resize());
    addEventListener("scroll", () => this._scroll(), { passive: true });
    document.addEventListener("visibilitychange", () => (this.tabHidden = document.hidden));

    this._live = new Set();
    this._io = new IntersectionObserver((es) => {
      for (const en of es) en.isIntersecting ? this._live.add(en.target) : this._live.delete(en.target);
      this.visible = this._live.size > 0;
      this.canvas.style.visibility = this.visible ? "visible" : "hidden";
    }, { rootMargin: "8% 0px" });
    document.querySelectorAll("[data-stage]").forEach((el) => this._io.observe(el));
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    if (!w || !h) return;
    this.w = w; this.h = h;
    this.mobile = w <= 760;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const a of this.actors) a.onResize?.(this);
    this._scroll();
  }

  _anchorY(st) {
    const el = document.querySelector(st.el);
    if (!el) return 0;
    const top = el.getBoundingClientRect().top + scrollY;
    return top + el.offsetHeight * (st.anchor ?? 0.5);
  }

  _scroll() {
    const y = scrollY + innerHeight * 0.5;
    const ys = this.stations.map((s) => this._anchorY(s));
    let p = 0;
    for (let i = 0; i < ys.length - 1; i++) if (y >= ys[i]) p = i + clamp((y - ys[i]) / Math.max(1, ys[i + 1] - ys[i]));
    this.progress = p;
    this.cam.target = p;
    if (reducedMotion()) this.cam.set(p);
  }

  /** Which station index the camera is nearest to (for actors deciding whether to work). */
  near(id, within = 0.75) {
    const i = this.stations.findIndex((s) => s.id === id);
    return i >= 0 && Math.abs(this.cam.value - i) < within;
  }

  _camAt(p) {
    const S = this.stations;
    const i = Math.floor(clamp(p, 0, S.length - 1));
    const j = Math.min(S.length - 1, i + 1);
    const A = S[i], B = S[j];
    // hold: the camera stays with this station for the first part of the scroll (e.g. while the hero scrolls away)
    const f = p - i, h = A.hold || 0;
    const e = smooth(Math.max(0, (f - h) / (1 - h)));
    const aPos = val(A.pos), aLook = val(A.look), bPos = val(B.pos), bLook = val(B.look);
    let pos, look;
    if (A.via && j !== i) {
      const q = (a, m, b) => a.map((v, k) => (1 - e) * (1 - e) * v + 2 * (1 - e) * e * m[k] + e * e * b[k]);
      pos = q(aPos, val(A.via.pos), bPos); look = q(aLook, val(A.via.look), bLook);
    } else {
      pos = aPos.map((v, k) => lerp(v, bPos[k], e)); look = aLook.map((v, k) => lerp(v, bLook[k], e));
    }
    // follow: while held, the station's plane scrolls 1:1 with its DOM section, so content never slides under text
    if (A.follow && f <= 1) {
      const el = document.querySelector(A.el);
      const px = el ? clamp(scrollY - (el.getBoundingClientRect().top + scrollY), 0, el.offsetHeight) : 0;
      const dist = Math.hypot(aPos[0] - aLook[0], aPos[1] - aLook[1], aPos[2] - aLook[2]);
      const upp = (2 * dist * Math.tan((this.camera.fov * Math.PI) / 360)) / this.h;
      const shift = px * upp * (1 - e);
      pos[1] -= shift; look[1] -= shift;
    }
    const oa = (this.mobile ? A.offsetMobile : A.offset) || [0, 0], ob = (this.mobile ? B.offsetMobile : B.offset) || [0, 0];
    return { pos, look, off: [lerp(oa[0], ob[0], e), lerp(oa[1], ob[1], e)] };
  }

  _frame(dt, t) {
    if (!this.visible || this.tabHidden || !this.w) return;
    this.cam.step(dt);
    const rm = reducedMotion();
    this.par.x.target = rm || !this.pointer.inside ? 0 : this.pointer.ndc.x;
    this.par.y.target = rm || !this.pointer.inside ? 0 : this.pointer.ndc.y;
    this.par.x.step(dt); this.par.y.step(dt);

    const { pos, look, off } = this._camAt(this.cam.value);
    const c = this.camera;
    c.position.set(pos[0] + this.par.x.value * 0.18, pos[1] + this.par.y.value * 0.12, pos[2]);
    c.lookAt(look[0], look[1], look[2]);
    c.setViewOffset(this.w, this.h, -off[0] * this.w, -off[1] * this.h, this.w, this.h);
    c.updateMatrixWorld();

    this.raycaster.setFromCamera(this.pointer.ndc, c);
    this.ray.o.copy(this.raycaster.ray.origin);
    this.ray.d.copy(this.raycaster.ray.direction);

    for (const a of this.actors) a.update?.(dt, t, this);
    if (this.bloom.enabled) this.composer.render(dt);
    else this.renderer.render(this.scene, c);
    this._adapt(dt);
  }

  /** Project a world point to client pixels. */
  project(v, out = { x: 0, y: 0, z: 0, visible: false }) {
    const p = v.clone().project(this.camera);
    out.x = (p.x * 0.5 + 0.5) * this.w;
    out.y = (-p.y * 0.5 + 0.5) * this.h;
    out.z = p.z;
    out.visible = p.z > -1 && p.z < 1;
    return out;
  }

  /** World-space rectangle visible on the plane z = zPlane for the camera at station 0 (the hero). */
  frustumAt(distance) {
    const h = 2 * distance * Math.tan((this.camera.fov * Math.PI) / 360);
    return { w: h * this.camera.aspect, h };
  }

  _adapt(dt) {
    // throttled or hidden windows deliver huge dt; they say nothing about GPU cost
    if (dt > 0.1 || clock.manual) return;
    const ft = this._ft;
    ft.push(dt * 1000);
    if (ft.length < 90) return;
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    ft.length = 0;
    if (avg > 24 && this.dpr > 1) { this.dpr = Math.max(1, this.dpr - 0.25); this.resize(); }
    else if (avg > 30 && this.bloom.enabled) this.bloom.enabled = false;
    else if (avg < 17.5 && this.dpr < this.maxDpr) { this.dpr = Math.min(this.maxDpr, this.dpr + 0.125); this.resize(); }
  }
}
