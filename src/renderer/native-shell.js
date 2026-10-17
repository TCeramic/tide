import { bindChoiceGroup } from "./vendor/design-systems/lens/lab/design-system/components.js";
import { tideShape } from "./point-formations.ts";
import { mountLiquidMetal } from "./liquid-metal.ts";
import { isRenderingActive } from "./render-activity.ts";
// Tide lifecycle and business bindings. The two renderers and controls are upstream code,
// vendored without edits at 7a424c93b9be13cf835b91ea67495fec2ec0584e (see NOTICE.md).
import * as THREE from "three";
import { paintLensBackground } from "./native-background.js";
import { createGlassSystem, createComponent } from "./vendor/design-systems/lens/lab/design-system/index.js";
import { clock as latticeClock } from "./vendor/design-systems/lattice/src/core/motion.js";
import { Field } from "./vendor/design-systems/lattice/src/gl/field.js";
import * as sets from "./vendor/design-systems/lattice/src/gl/sets.js";
import { WORLDS, applyWorldCss } from "./vendor/design-systems/lattice/src/core/theme.js";
import { mountTabs, mountSlider } from "./vendor/design-systems/lattice/src/dom/controls.js";
import { mountDotText } from "./vendor/design-systems/lattice/src/dom/dottext.js";
import { mountProgress } from "./lattice-progress.js";
import { mountCursor } from "./lattice-cursor.js";
import { mountLensShell } from "./lens-shell.js";
import { mountPaperBackground } from "./paper-background.ts";

export function createNativeSearch() {
  const control = createComponent("search", { label:"搜索", placeholder:"搜索音乐、歌手或专辑" });
  control.element.classList.add("native-search-control");
  return { ...control, input:control.element.querySelector("input") };
}

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
  let cursor = null;
  let appearance, glass = null, points = null, pointTier = "", destroyed = false;
  let widgetFrame = 0, widgetTimer = 0, widgetLast = 0;
  const widgetTick = now => {
    widgetFrame = 0;
    if (destroyed || !isRenderingActive() || appearance?.shell !== "lattice") return;
    const fps=appearance?.performance === "vivid" ? 60 : 30;
    if(widgetLast && now-widgetLast<1000/fps-.5){widgetFrame=requestAnimationFrame(widgetTick);return;}
    const dt = widgetLast ? Math.min(.05, (now - widgetLast) / 1000) : 1 / 30; widgetLast = now;
    latticeClock.time += dt; latticeClock._emit(dt);
    if(appearance?.performance === "vivid") widgetFrame=requestAnimationFrame(widgetTick);
    else widgetTimer = setTimeout(() => { widgetTimer = 0; widgetFrame = requestAnimationFrame(widgetTick); }, 1000 / 30);
  };
  const clockActivity = () => {
    cancelAnimationFrame(latticeClock._raf); latticeClock._raf = 0; latticeClock._last = 0;
    cancelAnimationFrame(widgetFrame); clearTimeout(widgetTimer); widgetFrame = 0; widgetTimer = 0; widgetLast = 0;
    if (!destroyed && appearance?.shell === "lattice" && isRenderingActive() && !latticeClock.manual) widgetFrame = requestAnimationFrame(widgetTick);
  };
  document.addEventListener("visibilitychange", clockActivity); clockActivity();
  const popupLayer = document.createElement("div");
  popupLayer.className = "native-popup-layer";
  document.body.append(popupLayer);
  for (const popup of root.querySelectorAll(".corner-panel")) popupLayer.append(popup);
  const metal=mountLiquidMetal(root);
  const paper = mountPaperBackground(root, () => {
    if (["paper","pixel-cover"].includes(appearance?.background)) {glass?.invalidateScene();dockGlass?.invalidateScene();}
  });
  let dockGlass=null;const dockRoot=root.querySelector('.dock-shell'),dockPortals=document.createElement('div');
  const syncDock=()=>{const visible=appearance?.shell==='lattice'&&document.documentElement.dataset.dockVisible==='true'&&isRenderingActive();
    if(visible&&dockRoot){dockGlass ||= mountLensShell(dockRoot,dockPortals,paintDockBackground);dockGlass.sync({...appearance,lensMode:appearance.latticeMode});}
    else{dockGlass?.destroy();dockGlass=null;}
  };
  const dockWatch=new MutationObserver(syncDock);dockWatch.observe(document.documentElement,{attributes:true,attributeFilter:['data-dock-visible','data-render-active']});
  function stopLens() { glass?.destroy(); glass = null; }
  function startLens() {
    glass ||= mountLensShell(document.body, popupLayer, paintPlayerBackground);
  }
  let image = null, imageUrl = "";
  function paintPlayerBackground(ctx, info) {
    if (["paper","pixel-cover"].includes(appearance.background) && paper.canvas?.width) {
      ctx.drawImage(paper.canvas, 0, 0, info.width, info.height);
    } else if (appearance.background === "image" && image?.complete && image.naturalWidth > 0) {
      const scale = Math.max(info.width / image.naturalWidth, info.height / image.naturalHeight);
      const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
      ctx.drawImage(image, (info.width - w) / 2, (info.height - h) / 2, w, h);
    } else if (appearance.background === "cover") {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--cover-tint").trim() || "#193f64";
      ctx.fillRect(0, 0, info.width, info.height);
    } else paintLensBackground(ctx, info);
  }
  function paintDockBackground(ctx,info){
    if(['paper','pixel-cover'].includes(appearance.background)&&paper.canvas?.width){const box=dockRoot.getBoundingClientRect(),host=root.getBoundingClientRect(),sx=paper.canvas.width/host.width,sy=paper.canvas.height/host.height;ctx.drawImage(paper.canvas,(box.left-host.left)*sx,(box.top-host.top)*sy,box.width*sx,box.height*sy,0,0,info.width,info.height);}
    else paintPlayerBackground(ctx,info);
  }
  function sync(next) {
    if (destroyed) return;
    appearance = next;
    applyWorldCss(next.shell === "lattice" && next.latticeMode === "light" ? "paper" : "night");
    if (next.shell === "lens") document.documentElement.style.colorScheme = document.documentElement.dataset.colorMode;
    clockActivity();
    paper.sync(next);metal.sync(next);syncDock();
    popupLayer.hidden = !next.chromeVisible;
    const cssImage = document.documentElement.style.getPropertyValue("--tide-image");
    const url = cssImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1] || "";
    if (url && url !== imageUrl) {
      imageUrl = url; image = new Image();
      image.onload = () => glass?.invalidateScene();
      image.src = url;
    }
    delete root.dataset.nativeFallback;
    if (next.shell === "lens") {
      cursor?.destroy?.(); cursor = null;
      points?.destroy(); points = null;
      startLens();
      glass.sync(next);
    } else stopLens();
    if (next.shell === "lattice") {
      cursor ||= mountCursor(); cursor.sync?.(next);
      if (points && pointTier !== next.performance) { points.destroy(); points = null; }
      if (!points) {
        try { points = mountPointField(root, next.performance); pointTier = next.performance; }
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
  const enhancedRanges = new Set(), progressViews=[];
  function enhanceRanges() {
    for(const input of root.querySelectorAll('.transport input[type="range"]')) {
      if(enhancedRanges.has(input))continue;enhancedRanges.add(input);
      const wrap=document.createElement("span");
      const seek=input.getAttribute("aria-label")==="进度";
      wrap.className=seek?"lx-progress native-point-range native-point-progress":"lx-slider native-point-range";
      input.before(wrap);wrap.append(input);
      if(seek) {
        const view=mountProgress(wrap);progressViews.push(view);wrap.setAttribute("aria-hidden","false");
        // Preserve the real range input's keyboard/drag semantics; canvas is decoration.
        wrap.removeAttribute("role");wrap.removeAttribute("aria-valuemin");wrap.removeAttribute("aria-valuemax");
        const update=()=>{wrap.dataset.playing=input.dataset.playing||"false";view.set(Number(input.max)>0?Number(input.value)/Number(input.max):0);};
        input.addEventListener("input",update);input.addEventListener("tide:progress",update);update();
      } else mountSlider(input);
    }
  }
  const rangeObserver = new MutationObserver(records=>{
    if(records.some(r=>[...r.addedNodes].some(n=>n instanceof Element && (n.matches('.transport,input[type="range"]')||n.querySelector('.transport,input[type="range"]')))))enhanceRanges();
  });
  rangeObserver.observe(root,{childList:true,subtree:true});enhanceRanges();
  return { sync, visualState:()=>({phase:paper.getPhase(),paper:paper.state(),points:points?.state()}),restoreVisualState:async state=>{if(state){await paper.restore(state.paper);paper.setPhase(state.phase);points?.restore(state.points);}}, ready:()=>{glass?.ready();}, destroy() { destroyed = true; cursor?.destroy?.(); document.removeEventListener("visibilitychange", clockActivity); cancelAnimationFrame(latticeClock._raf); cancelAnimationFrame(widgetFrame); clearTimeout(widgetTimer); stopLens(); points?.destroy();dockWatch.disconnect();dockGlass?.destroy();dockGlass=null; paper.destroy();metal.destroy(); for(const view of progressViews)view.destroy();rangeObserver.disconnect(); popupLayer.remove(); } };
}

// Embed the original Field and set generators into a desktop viewport. This host supplies
// the same Stage contract without the showcase's page scrolling or permanent global listeners.
function mountPointField(root, tier = "balanced") {
  const canvas = document.createElement("canvas");
  canvas.className = "native-point-field";
  canvas.setAttribute("aria-hidden", "true");
  root.prepend(canvas);
  let renderer, field, frame = 0, paused = false, active = true, dead = false, last = 0, time = 0, setIndex = -1;
  let renderTimer = 0, lastPaint = 0, interactionUntil = 0, nextFormationAt=22;
  let currentAppearance=null,targetInk=null,targetHot=null;
  const contrastWorld=()=>{if(!currentAppearance)return;const light=currentAppearance.latticeMode==="light",base=light?WORLDS.paper:WORLDS.night;let mean=[.5,.5,.5],accent='#66baff';try{const colors=JSON.parse(document.documentElement.style.getPropertyValue('--generated-colors'));if(colors?.[0])mean=colors[0].slice(1).match(/../g).map(v=>parseInt(v,16)/255);accent=document.documentElement.style.getPropertyValue('--cover-tint').trim()||accent;}catch{}
    const bg=mean.map(v=>v*(light?.65:.52)+(light?.32:.015)),linear=bg.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4),lum=linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
    const pale=(1.05/(lum+.05))>((lum+.05)/.065),ink=document.documentElement.dataset.customColors==='true'?getComputedStyle(document.documentElement).getPropertyValue('--custom-points').trim():(pale?'#eef6ff':'#152c42');const rgb=accent.slice(1).match(/../g)?.map(v=>parseInt(v,16)/255)??[.4,.7,1],hot='#'+rgb.map(v=>Math.round((pale?v*.25+.75:v*.45)*255).toString(16).padStart(2,'0')).join('');
    const oldInk=field.du.uInk.value.clone(),oldHot=field.du.uHot.value.clone();field.setWorld({...base,ink,hot,dotGain:Math.max(1.1,base.dotGain)});targetInk=new THREE.Color(ink);targetHot=new THREE.Color(hot);field.du.uInk.value.copy(oldInk);field.du.uHot.value.copy(oldHot);canvas.dataset.pointInk=ink;
  };
  const targetFps = tier === "vivid" ? 120 : tier === "smooth" ? 20 : 30;
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
    field = new Field(stage, { size: tier === "vivid" ? 160 : tier === "smooth" ? 96 : 128 }); field.useSets(sets); field.setWorld(WORLDS.night);
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
  window.addEventListener("tide:palette",()=>{contrastWorld();wake();},{signal});
  // A reserved, empty layout slot for the actual upstream GPU word. Business
  // panels sit below this rectangle; no duplicate text is painted over it.
  const hero = document.createElement("div");
  hero.className = "native-point-hero";
  hero.setAttribute("role", "img"); hero.setAttribute("aria-label", "TIDE 点阵展示区");
  root.append(hero);
  const alignHero=()=>{const cover=document.querySelector(document.documentElement.dataset.view==="playing"?".lyrics-cover":".home-cover"),box=cover?.getBoundingClientRect();if(box&&box.width>0){const width=Math.min(360,Math.max(240,box.width)),origin=root.getBoundingClientRect();hero.style.width=width+"px";hero.style.left=(box.left-origin.left+(box.width-width)/2)+"px";if(document.documentElement.dataset.view==="playing"){const h=Math.min(96,Math.max(40,box.top-52));hero.style.height=h+"px";hero.style.top=Math.max(36,Math.min(140,box.top-h-12))+"px";}else{const grid=document.querySelector(".home-grid")?.getBoundingClientRect();hero.style.height="96px";hero.style.top=Math.max(108,(grid?.top??240)-112)+"px";}}};
  let layoutFrame=0;
  const layoutChange=new MutationObserver(()=>{cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(()=>{layoutFrame=0;if(dead)return;alignHero();if(setIndex===0)showSet(0);});});layoutChange.observe(document.documentElement,{attributes:true,attributeFilter:["data-view"]});
  const coverResize=new ResizeObserver(()=>{if(dead)return;alignHero();if(setIndex===0)showSet(0);});for(const el of document.querySelectorAll('.lyrics-cover,.home-cover'))coverResize.observe(el);
  const formations = [
    { caption: "POINT SETS", build: lattice => {
      alignHero();const map = sets.matrixText("TIDE", 1);
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
      ...[...["saturn","helix","shell","heart","orbit"].map(kind=>[kind.toUpperCase(),n=>tideShape(n,kind)])],
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
    field.keep(set.build, set.options); caption.textContent = set.caption;canvas.dataset.pointSet=String(setIndex);canvas.dataset.pointSetCount=String(formations.length);nextFormationAt=time+22;
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
    alignHero();
    stage.w = Math.max(2, root.clientWidth); stage.h = Math.max(2, root.clientHeight);
    stage.mobile = stage.w <= 760;
    camera.aspect = stage.w / stage.h; camera.updateProjectionMatrix();
    const maxPixels = tier === "vivid" ? 1800000 : tier === "smooth" ? 700000 : 1100000;
    renderer.setPixelRatio(Math.min(stage.dpr, Math.sqrt(maxPixels / (stage.w * stage.h)))); renderer.setSize(stage.w, stage.h, false);
    field.setOffset = new THREE.Vector3(stage.mobile ? 0 : 1.35, 0.25, 0.7);
    field.onResize(stage); if (paused) snapStill(); wake();
  }
  function updateRay() {
    camera.updateMatrixWorld(); raycaster.setFromCamera(pointer.ndc, camera);
    stage.ray.o.copy(raycaster.ray.origin); stage.ray.d.copy(raycaster.ray.direction);
  }
  const move = event => {
    if (pointer.down) interactionUntil = performance.now() + 500;
    pointer.x = event.clientX; pointer.y = event.clientY;
    pointer.ndc.set(pointer.x / stage.w * 2 - 1, -(pointer.y / stage.h) * 2 + 1);
    pointer.inside = !event.target.closest("button,input,select,textarea,a,label,summary,.home-card,.corner-panel,.browse-sheet,.proof-host");
    if (pointer.down) pointer.moved += Math.abs(event.movementX || 0) + Math.abs(event.movementY || 0);
    // Ray and GPU interaction are coalesced once per rendered frame.
    wake();
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
    if (dead || !active || !isRenderingActive()) { last = 0; return; }
    if(tier === "vivid" && lastPaint && now-lastPaint<1000/120-.5){wake();return;}
    lastPaint = now;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60; last = now;
    time += paused ? 0 : dt;
    if(!paused&&!pointer.down&&time>=nextFormationAt)showSet(setIndex+1);
    if(targetInk){field.du.uInk.value.lerp(targetInk,1-Math.exp(-dt*7));field.du.uHot.value.lerp(targetHot,1-Math.exp(-dt*7));}
    updateRay(); field.onPointerMove(stage); field.update(paused ? 0 : dt, time, stage); renderer.render(scene, camera);
    if (!paused) wake();
  }
  function wake() {
    if (dead || !active || !isRenderingActive() || frame || renderTimer) return;
    if(tier === "vivid") { frame=requestAnimationFrame(loop);return; }
    const fps = performance.now() < interactionUntil ? 60 : targetFps;
    const wait = Math.max(0, 1000 / fps - (performance.now() - lastPaint));
    renderTimer = setTimeout(() => { renderTimer = 0; if (!dead && active && isRenderingActive()) frame = requestAnimationFrame(loop); }, wait);
  }
  document.addEventListener("visibilitychange", () => { if (!isRenderingActive()) { cancelAnimationFrame(frame); clearTimeout(renderTimer); renderTimer = 0; frame = 0; last = 0; } else wake(); }, { signal });
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(root);
  resize(); showSet(0);
  return {
    state:()=>({index:setIndex,time}),
    restore(value){if(value){time=Number(value.time)||0;showSet(Number(value.index)||0);snapStill();}},
    setActive(on) {
      active = on; canvas.hidden = !on; badge.hidden = !on; hero.hidden = !on; stage.visible = on;
      if (!on) { field.holding = false; pointer.down = false; cancelAnimationFrame(frame); clearTimeout(renderTimer); renderTimer = 0; frame = 0; last = 0; }
      else wake();
    },
    sync(appearance) {
      currentAppearance=appearance;
      paused = appearance.performance === "smooth" || appearance.motion === 0 || matchMedia("(prefers-reduced-motion: reduce)").matches;
      stage.dpr = appearance.performance === "vivid" ? Math.min(2, devicePixelRatio || 1) : appearance.performance === "smooth" ? 1 : Math.min(1.5, devicePixelRatio || 1);
      const world = appearance.latticeMode === "light" ? WORLDS.paper : WORLDS.night;
      contrastWorld();
      scene.background = appearance.shell === "lens" || ["paper","pixel-cover"].includes(appearance.background) ? null : new THREE.Color(world.bg);
      canvas.style.opacity = String(appearance.stageLevel * (appearance.shell === "lens" ? 0.3 : 1));
      resize(); wake();
    },
    destroy() {
      dead = true; abort.abort(); resizeObserver.disconnect();layoutChange.disconnect();coverResize.disconnect();cancelAnimationFrame(layoutFrame); clearTimeout(renderTimer); cancelAnimationFrame(frame);
      field.gpu.dispose(); field.tSeed.dispose(); field.tTarget.dispose(); field.tPrev.dispose();
      field.points.geometry.dispose(); field.drawMat.dispose(); field.shadow.material.dispose();
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); badge.remove(); hero.remove();
    },
  };
}

export function syncPreviewChoices(values){for(const row of document.querySelectorAll(".native-choice-row")){const value=values[row.querySelector(".native-choice-label")?.textContent??""];if(!value)continue;const lens=row.querySelector(".native-lens-choices");if(lens)bindChoiceGroup(lens,{value});const point=row.querySelector(".native-point-choices");if(point){const buttons=Array.from(point.querySelectorAll("button[data-value]"));const index=buttons.findIndex(b=>b.dataset.value===value);if(index>=0){const tabs=mountTabs(point);tabs.select(index,false);}}}}
