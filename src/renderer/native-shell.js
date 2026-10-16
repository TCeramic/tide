// Tide lifecycle and business bindings. The two renderers and controls are upstream code,
// vendored without edits at 7a424c93b9be13cf835b91ea67495fec2ec0584e (see NOTICE.md).
import * as THREE from "three";
import { paintLensBackground } from "./native-background.js";
import { createGlassSystem, createComponent } from "./vendor/design-systems/lens/lab/design-system/index.js";
import { Field } from "./vendor/design-systems/lattice/src/gl/field.js";
import * as sets from "./vendor/design-systems/lattice/src/gl/sets.js";
import { WORLDS } from "./vendor/design-systems/lattice/src/core/theme.js";
import { mountTabs, mountSlider } from "./vendor/design-systems/lattice/src/dom/controls.js";
import { mountDotText } from "./vendor/design-systems/lattice/src/dom/dottext.js";
import { mountPaperBackground } from "./paper-background.ts";

export function createNativeChoiceRow(label, options, onPick) {
  const element = document.createElement("div");
  element.className = "native-choice-row";
  const heading = document.createElement("span");
  heading.className = "native-choice-label";
  heading.textContent = label;
  const lens = createComponent("choices", {
    label, value: options[0].id,
    options: options.map(o => ({ value: o.id, label: o.label })),
    onChange: value => onPick(value),
  });
  lens.element.classList.add("native-lens-choices");
  const lattice = document.createElement("div");
  lattice.className = "lx-tabs native-point-choices";
  lattice.setAttribute("role", "tablist");
  lattice.setAttribute("aria-label", label);
  options.forEach((o, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = o.label;
    b.dataset.value = o.id;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(i === 0));
    lattice.append(b);
  });
  element.append(heading, lens.element, lattice);
  // Wait for the element to be inserted before measuring its dot indicator.
  let pointTabs, syncing = false, current = options[0].id;
  const mount = () => {
    if (!element.isConnected) return;
    pointTabs = mountTabs(lattice);
    sync(current);
  };
  requestAnimationFrame(mount);
  lattice.addEventListener("tabs:change", event => {
    if (!syncing) onPick(event.detail.value);
  });
  function sync(value) {
    current = value;
    lens.setValue(value);
    const index = options.findIndex(o => o.id === value);
    if (pointTabs && index >= 0 && pointTabs.index !== index) {
      syncing = true;
      pointTabs.select(index, false);
      syncing = false;
    }
  }
  return { element, sync };
}

export function openDesignCatalog(shell) {
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "design-catalog";
  dialog.setAttribute("aria-label", shell === "lens" ? "透镜完整组件" : "点阵完整组件");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "catalog-close";
  close.textContent = "关闭组件展示";
  const frame = document.createElement("iframe");
  frame.title = shell === "lens" ? "Lens 原版完整展示" : "Lattice 原版完整展示";
  // No Electron bridge or parent-origin access in the original interactive showcase.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.src = shell === "lens"
    ? "./design-systems/lens/lens-showcase-standalone.html"
    : "./design-systems/lattice/dist/lattice-showcase.html";
  const dispose = () => { dialog.remove(); previousFocus?.focus(); };
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", dispose, { once: true });
  dialog.append(close, frame);
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}

export function mountNativeShell(root) {
  let appearance, glass = null, points = null, observer, destroyed = false;
  const popupSystems = new Map();
  const popupLayer = document.createElement("div");
  popupLayer.className = "native-popup-layer";
  document.body.append(popupLayer);
  for (const popup of root.querySelectorAll(".corner-panel")) popupLayer.append(popup);
  const panelSelector = ".home-card,.queue-col,.browse-sheet,.corner-panel,.transport,.topbar,.proof-host,.risk";
  const buttonSelector = "button:not(.lg-choice):not([role=tab]):not([data-lg-component])";
  const decorated = new Map();
  const paper = mountPaperBackground(root, () => {
    if (appearance?.background !== "paper") return;
    glass?.renderer?.setScene(appearance.theme === "dusk" ? "ocean" : "aurora");
    for (const [popup, system] of popupSystems) if (!popup.hidden) system.renderer?.setScene(appearance.theme === "dusk" ? "ocean" : "aurora");
  });
  const saved = (el) => {
    if (!decorated.has(el)) decorated.set(el, { className: el.className, glass: el.getAttribute("data-glass"), drag: el.getAttribute("data-lg-drag"), sound: el.getAttribute("data-lg-sound") });
  };
  function decorate() {
    if (!glass) return;
    for (const scope of [root, popupLayer]) {
    scope.querySelectorAll(panelSelector).forEach(el => {
      if (el.closest(".native-point-choices")) return;
      saved(el);
      el.classList.add("lg-surface");
      el.dataset.glass = el.matches(".transport") ? "dock" : "panel";
    });
    scope.querySelectorAll(buttonSelector).forEach(el => {
      if (el.closest(".native-point-choices")) return;
      saved(el);
      el.classList.add("lg-surface");
      el.dataset.glass = "button";
      el.dataset.lgDrag = "press";
      el.dataset.lgSound ||= "press";
    });
    }
    glass.mount();
    for (const popup of popupLayer.querySelectorAll(".corner-panel")) {
      if (!popupSystems.has(popup)) {
        popupSystems.set(popup, createGlassSystem(popup, {
          material: "thick", scene: appearance.theme === "dusk" ? "ocean" : "aurora",
          artwork: paintPlayerBackground, motion: appearance.motion > 0, audio: {},
        }));
      } else popupSystems.get(popup).mount();
    }
  }
  function stopLens() {
    observer?.disconnect();
    observer = null;
    for (const [popup, system] of popupSystems) {
      system.destroy(); popup.classList.remove("lg-stage", "fallback", "webgl-ready");
    }
    popupSystems.clear();
    glass?.destroy();
    glass = null;
    root.classList.remove("lg-stage", "fallback", "webgl-ready");
    for (const [el, original] of decorated) {
      // Keep business state classes added since decoration (e.g. selected/liked).
      if (!original.className.split(/\s+/).includes("lg-surface")) el.classList.remove("lg-surface");
      for (const [attr, value] of [["data-glass", original.glass], ["data-lg-drag", original.drag], ["data-lg-sound", original.sound]]) {
        value === null ? el.removeAttribute(attr) : el.setAttribute(attr, value);
      }
    }
    decorated.clear();
  }
  function startLens() {
    if (glass) return;
    glass = createGlassSystem(root, {
      material: "thick", scene: "aurora", artwork: paintPlayerBackground, motion: appearance.motion > 0,
      audio: {},
      onFallback: error => { root.dataset.nativeFallback = "lens"; console.warn("Lens WebGL fallback", error); },
    });
    decorate();
    // Business views are mounted lazily. Register their native surfaces on insertion.
    observer = new MutationObserver(records => {
      if (records.some(r => r.addedNodes.length || r.removedNodes.length)) {
        for (const [el] of decorated) {
          if (!el.isConnected) {
            glass.jelly.bodies.delete(el);
            decorated.delete(el);
          }
        }
        decorate();
        glass.renderer?.invalidate(350, true);
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }
  let image = null, imageUrl = "";
  function paintPlayerBackground(ctx, info) {
    if (appearance.background === "paper" && paper.canvas?.width) {
      ctx.drawImage(paper.canvas, 0, 0, info.width, info.height);
    } else if (appearance.background === "image" && image?.complete && image.naturalWidth > 0) {
      const scale = Math.max(info.width / image.naturalWidth, info.height / image.naturalHeight);
      const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
      ctx.drawImage(image, (info.width - w) / 2, (info.height - h) / 2, w, h);
    } else if (appearance.background === "cover" || appearance.preset === "cover-glow") {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--cover-tint").trim() || "#193f64";
      ctx.fillRect(0, 0, info.width, info.height);
    } else if (appearance.preset === "quiet") {
      ctx.fillStyle = info.scene === "ocean" ? "#193f64" : "#f7f8fa";
      ctx.fillRect(0, 0, info.width, info.height);
    } else paintLensBackground(ctx, info);
  }
  function sync(next) {
    if (destroyed) return;
    appearance = next;
    paper.sync(next);
    popupLayer.hidden = !next.chromeVisible;
    const cssImage = document.documentElement.style.getPropertyValue("--tide-image");
    const url = cssImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1] || "";
    if (url && url !== imageUrl) {
      imageUrl = url; image = new Image();
      image.onload = () => glass?.renderer?.setScene(next.theme === "dusk" ? "ocean" : "aurora");
      image.src = url;
    }
    delete root.dataset.nativeFallback;
    if (next.shell === "lens") {
      points?.setActive(false);
      startLens();
      glass.renderer?.set({ motion: next.motion > 0, scene: next.theme === "dusk" ? "ocean" : "aurora" });
      if (glass.renderer) glass.renderer.canvas.style.opacity = String(next.stageLevel);
      glass.jelly.setIntensity(next.motion > 0 ? 0.7 * next.motion : 0);
      for (const system of popupSystems.values()) {
        system.renderer?.set({ motion: next.motion > 0, scene: next.theme === "dusk" ? "ocean" : "aurora" });
        system.jelly.setIntensity(next.motion > 0 ? 0.7 * next.motion : 0);
      }
    } else stopLens();
    if (next.shell === "lattice" || next.lattice) {
      if (!points) {
        try { points = mountPointField(root); }
        catch (error) {
          root.dataset.nativeFallback = "lattice";
          console.warn("Lattice WebGL unavailable; native DOM controls remain available", error);
        }
      }
      points?.sync(next);
      points?.setActive(true);
    }
  }
  // Use the actual upstream point slider for the existing volume/seek inputs.
  const enhancedRanges = new Set();
  const rangeObserver = new MutationObserver(() => {
    for (const input of root.querySelectorAll('.transport input[type="range"]')) {
      if (enhancedRanges.has(input)) continue;
      enhancedRanges.add(input);
      const wrap = document.createElement("span");
      wrap.className = "lx-slider native-point-range";
      input.before(wrap); wrap.append(input); mountSlider(input);
    }
  });
  rangeObserver.observe(root, { childList: true, subtree: true });
  // A first mutation is not guaranteed after mount.
  for (const input of root.querySelectorAll('.transport input[type="range"]')) {
    enhancedRanges.add(input);
    const wrap = document.createElement("span");
    wrap.className = "lx-slider native-point-range";
    input.before(wrap); wrap.append(input); mountSlider(input);
  }
  return { sync, destroy() { destroyed = true; stopLens(); points?.destroy(); paper.destroy(); rangeObserver.disconnect(); popupLayer.remove(); } };
}

// Embed the original Field and set generators into a desktop viewport. This host supplies
// the same Stage contract without the showcase's page scrolling or permanent global listeners.
function mountPointField(root) {
  const canvas = document.createElement("canvas");
  canvas.className = "native-point-field";
  canvas.setAttribute("aria-hidden", "true");
  root.prepend(canvas);
  let renderer, field, frame = 0, paused = false, active = true, dead = false, last = 0, time = 0, setIndex = -1;
  const abort = new AbortController();
  const signal = abort.signal;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 400);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
  const scene = new THREE.Scene();
  const pointer = { x: 0, y: 0, ndc: new THREE.Vector2(), inside: false, down: false, moved: 0 };
  const raycaster = new THREE.Raycaster();
  const stage = {
    renderer: null, scene, camera, pointer, visible: true, w: 1, h: 1, dpr: 1.5, mobile: false,
    cam: { value: 0 }, stations: [{ id: "hero", hold: 0.7 }],
    ray: { o: new THREE.Vector3(), d: new THREE.Vector3(0, 0, -1) },
    near: id => id === "hero",
    frustumAt(distance) {
      const h = 2 * distance * Math.tan(camera.fov * Math.PI / 360);
      return { w: h * camera.aspect, h };
    },
  };
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });
    stage.renderer = renderer;
    scene.background = new THREE.Color(WORLDS.night.bg);
    field = new Field(stage); field.useSets(sets); field.setWorld(WORLDS.night);
    scene.add(field.object);
  } catch (error) {
    renderer?.dispose(); renderer?.forceContextLoss(); canvas.remove(); throw error;
  }
  const badge = document.createElement("div");
  badge.className = "native-set-control";
  const counter = document.createElement("span"); counter.textContent = "01";
  const caption = document.createElement("span"); caption.className = "native-set-caption";
  const next = document.createElement("button"); next.type = "button"; next.className = "lx-btn lx-btn--ghost"; next.textContent = "下一点集";
  badge.append(counter, caption, next); root.append(badge);
  const number = mountDotText(counter, { pitch: 3 });
  // A reserved, empty layout slot for the actual upstream GPU word. Business
  // panels sit below this rectangle; no duplicate text is painted over it.
  const hero = document.createElement("div");
  hero.className = "native-point-hero";
  hero.setAttribute("role", "img"); hero.setAttribute("aria-label", "TIDE 点阵展示区");
  root.append(hero);
  const formations = [
    { caption: "POINT SETS", build: lattice => {
      const map = sets.matrixText("TIDE", 1);
      const data = lattice.lit([{ map, col: 0, row: 0 }], { lift: 0, swarm: 0.24 });
      const box = hero.getBoundingClientRect(), host = root.getBoundingClientRect();
      const pitch = Math.min(12, (box.width - 24) / map.w, (box.height - 24) / map.h);
      const left = box.left - host.left + (box.width - (map.w - 1) * pitch) / 2;
      const top = box.top - host.top + (box.height - (map.h - 1) * pitch) / 2;
      const frustum = stage.frustumAt(field.distance);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 0.5) continue;
        const x = left + (data[i] - lattice.x0) / lattice.pitch * pitch;
        const y = top + (lattice.y0 - data[i + 1]) / lattice.pitch * pitch;
        data[i] = (x / stage.w - 0.5) * frustum.w;
        data[i + 1] = (0.5 - y / stage.h) * frustum.h;
        data[i + 2] = 0;
      }
      return data;
    }, options: { sweep: [1, 0, 0], span: 9, dur: 1.5, lit: 1.6, flow: 2.4, alpha: 0.42 } },
    ...[
      ["LORENZ ATTRACTOR", n => sets.lorenz(n, 1.95)],
      ["TREFOIL KNOT", n => sets.torusKnot(n, 2, 3, 1.95)],
      ["FCC CRYSTAL", n => sets.crystal(n, 1.95)],
      ["KLEIN BOTTLE", n => sets.klein(n, 2.05)],
    ].map(([caption, make]) => {
      let cache;
      return { caption, build: lattice => lattice.shape(cache ||= make(field.N)),
        options: { is3d: true, sweep: [0, -1, 0], span: 5, dur: 1.7, lit: 1, flow: 3.2, alpha: 0.22 } };
    }),
  ];
  function showSet(index) {
    setIndex = (index + formations.length) % formations.length;
    const set = formations[setIndex];
    field.keep(set.build, set.options); caption.textContent = set.caption;
    number.set(String(setIndex + 1).padStart(2, "0"));
    if (paused) snapStill();
    wake();
  }
  function snapStill() {
    // A stopped simulation must still follow window resizes and selected sets.
    // Seed both upstream GPU buffers with the target instead of freezing an
    // unfinished morph at the old window coordinates.
    const data = field.tTarget.image.data.slice(), point = new THREE.Vector3();
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0.5) {
      point.fromArray(data, i).applyMatrix4(field.setMat); point.toArray(data, i);
    }
    const positions = field._dataTex(data), velocities = field.gpu.createTexture();
    for (const target of field.pos.renderTargets) field.gpu.renderTexture(positions, target);
    for (const target of field.vel.renderTargets) field.gpu.renderTexture(velocities, target);
    positions.dispose(); velocities.dispose();
    field.du.uLit.value = field.litTarget;
    field.du.uLitAlpha.value = field.alphaTarget;
  }
  function resize() {
    stage.w = Math.max(2, root.clientWidth); stage.h = Math.max(2, root.clientHeight);
    stage.mobile = stage.w <= 760;
    camera.aspect = stage.w / stage.h; camera.updateProjectionMatrix();
    renderer.setPixelRatio(stage.dpr); renderer.setSize(stage.w, stage.h, false);
    field.setOffset = new THREE.Vector3(stage.mobile ? 0 : 1.35, 0.25, 0.7);
    field.onResize(stage); if (paused) snapStill(); wake();
  }
  function updateRay() {
    camera.updateMatrixWorld(); raycaster.setFromCamera(pointer.ndc, camera);
    stage.ray.o.copy(raycaster.ray.origin); stage.ray.d.copy(raycaster.ray.direction);
  }
  const move = event => {
    const rect = root.getBoundingClientRect();
    pointer.x = event.clientX - rect.left; pointer.y = event.clientY - rect.top;
    pointer.ndc.set(pointer.x / stage.w * 2 - 1, -(pointer.y / stage.h) * 2 + 1);
    pointer.inside = true;
    if (pointer.down) pointer.moved += Math.abs(event.movementX || 0) + Math.abs(event.movementY || 0);
    updateRay(); field.onPointerMove(stage); wake();
  };
  root.addEventListener("pointermove", move, { signal, passive: true });
  root.addEventListener("pointerdown", event => {
    if (event.target.closest("button,input,select,textarea,a,label,summary,.home-card,.corner-panel,.browse-sheet,.proof-host")) return;
    move(event); pointer.down = true; pointer.moved = 0; field.onPointerDown(stage); wake();
  }, { signal });
  window.addEventListener("pointerup", () => { pointer.down = false; field.onPointerUp(stage); wake(); }, { signal });
  window.addEventListener("pointercancel", () => { pointer.down = false; field.onPointerUp(stage); }, { signal });
  root.addEventListener("pointerleave", () => { pointer.inside = false; }, { signal });
  next.addEventListener("click", () => showSet(setIndex + 1), { signal });
  field.addEventListener("release", event => { if (event.detail.melted) showSet(setIndex + 1); }, { signal });
  function loop(now) {
    frame = 0;
    if (dead || !active || document.hidden) { last = 0; return; }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60; last = now;
    time += paused ? 0 : dt;
    updateRay(); field.update(paused ? 0 : dt, time, stage); renderer.render(scene, camera);
    if (!paused && !frame) frame = requestAnimationFrame(loop);
  }
  function wake() { if (!dead && active && !document.hidden && !frame) frame = requestAnimationFrame(loop); }
  document.addEventListener("visibilitychange", () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; last = 0; } else wake(); }, { signal });
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(root);
  resize(); showSet(0);
  return {
    setActive(on) {
      active = on; canvas.hidden = !on; badge.hidden = !on; hero.hidden = !on; stage.visible = on;
      if (!on) { field.holding = false; pointer.down = false; cancelAnimationFrame(frame); frame = 0; last = 0; }
      else wake();
    },
    sync(appearance) {
      paused = appearance.motion === 0 || matchMedia("(prefers-reduced-motion: reduce)").matches;
      stage.dpr = appearance.performance === "vivid" ? Math.min(2, devicePixelRatio || 1) : appearance.performance === "smooth" ? 1 : Math.min(1.5, devicePixelRatio || 1);
      scene.background = appearance.shell === "lens" || appearance.background === "paper" ? null : new THREE.Color(WORLDS.night.bg);
      canvas.style.opacity = String(appearance.stageLevel * (appearance.shell === "lens" ? 0.3 : 1));
      resize(); wake();
    },
    destroy() {
      dead = true; abort.abort(); resizeObserver.disconnect(); cancelAnimationFrame(frame);
      field.gpu.dispose(); field.tSeed.dispose(); field.tTarget.dispose(); field.tPrev.dispose();
      field.points.geometry.dispose(); field.drawMat.dispose(); field.shadow.material.dispose();
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); badge.remove(); hero.remove();
    },
  };
}
