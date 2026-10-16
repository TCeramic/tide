import { isRenderingActive } from "../render-activity";
import { onShellView } from "../view";
import * as THREE from "three";
import { catalogFromPlaylists, latticeRecords, type LatticeNode } from "../../core/proof-catalog";
import type { PlaylistSummary, SearchHit } from "../../shared/contract";
import { ProofTree } from "../vendor/design-systems/lattice/src/gl/prooftree.js";

const kinds = { library: "音乐", playlist: "播放列表", artist: "歌手", album: "专辑", song: "单曲" };
const PAGE_SIZE = 8;

/** Original MIT renderer, with a bounded one-level viewport and explicit page navigation. */
export function mountProof(host: HTMLElement, onSong: (id: string, name: string) => void, onExit: () => void) {
  host.setAttribute("aria-label", "音乐脉络");
  const header = document.createElement("header");
  header.className = "proof-header";
  const exit = button("← 返回主页", onExit);
  exit.classList.add("proof-exit");
  const title = document.createElement("h2");
  title.textContent = "音乐脉络";
  const up = button("返回上一级", () => { if (path.length > 1) { path.pop(); page = 0; render(); } });
  header.append(exit, title, up);
  const crumbs = document.createElement("nav");
  crumbs.className = "proof-breadcrumbs";
  crumbs.setAttribute("aria-label", "音乐脉络路径");
  const body = document.createElement("div");
  body.className = "proof-body";
  const visual = document.createElement("div");
  visual.className = "proof-visual";
  const canvas = document.createElement("canvas");
  canvas.className = "proof-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const labels = document.createElement("div");
  labels.className = "proof-labels";
  visual.append(canvas, labels);
  const aside = document.createElement("aside");
  aside.className = "proof-aside";
  const status = document.createElement("p");
  status.className = "proof-status";
  const list = document.createElement("div");
  list.className = "proof-list";
  const pager = document.createElement("div");
  pager.className = "proof-pager";
  aside.append(status, list, pager);
  body.append(visual, aside);
  host.append(header, crumbs, body);
  let nodes = new Map<string, LatticeNode>();
  let path: string[] = [];
  let page = 0;
  let frame = 0, drawTimer = 0;
  let disposeGl = () => {};
  let running = false;
  let restart = () => {};

  function stopGl() { cancelAnimationFrame(frame); clearTimeout(drawTimer); drawTimer = 0; frame = 0; disposeGl(); disposeGl = () => {}; }
  function stop() { running = false; stopGl(); }
  function navigate(id: string) {
    const node = nodes.get(id);
    if (!node) return;
    if (node.kind === "song") { onSong(node.songId!, node.name); return; }
    if (id === path.at(-1)) return;
    path.push(id); page = 0; render();
  }
  function render() {
    stopGl();
    const current = nodes.get(path.at(-1)!);
    if (!current) return;
    up.disabled = path.length < 2;
    crumbs.replaceChildren(...path.map((id, index) => button(nodes.get(id)!.name, () => {
      path = path.slice(0, index + 1); page = 0; render();
    })));
    const children = current.deps.map(id => nodes.get(id)!).filter(Boolean);
    const shown = children.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    status.textContent = children.length ? `${current.name} · ${children.length} 个${kinds[children[0].kind]}` : "播放队列为空，先选择一些歌曲。";
    list.replaceChildren(...shown.map(node => {
      const row = button("", () => navigate(node.id));
      row.classList.add("proof-node");
      const kind = document.createElement("small"); kind.textContent = kinds[node.kind];
      const name = document.createElement("strong"); name.textContent = node.name;
      const detail = document.createElement("span"); detail.textContent = node.kind === "song" ? "点击播放" : `${node.deps.length} 个${node.kind === "artist" ? "专辑" : "单曲"} →`;
      row.append(kind, name, detail); return row;
    }));
    pager.replaceChildren();
    if (children.length > PAGE_SIZE) {
      const prev = button("上一组", () => { page--; render(); }); prev.disabled = page === 0;
      const next = button("下一组", () => { page++; render(); }); next.disabled = (page + 1) * PAGE_SIZE >= children.length;
      const count = document.createElement("span"); count.textContent = `${page + 1} / ${Math.ceil(children.length / PAGE_SIZE)}`;
      pager.append(prev, count, next);
    }
    labels.replaceChildren();
    if (!shown.length || !isRenderingActive() || host.hidden) return;
    try {
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
      camera.position.set(0, 1.5, 5.2); camera.lookAt(0, 0.45, 0);
      // Give the original renderer only the current node and eight immediate children.
      const records = latticeRecords([{ ...current, deps: shown.map(n => n.id) }, ...shown.map(n => ({ ...n, deps: [], leaf: true }))]);
      const tree = new ProofTree({ byId: records, station: "tree", ground: false });
      tree.shared.uSize.value = 1.2;
      scene.add(tree.object);
      const abort = new AbortController();
      let width = 0, height = 0, last = 0;
      const stage = { scene, camera, renderer, dpr: renderer.getPixelRatio(), pointer: { x: 0, y: 0, inside: false }, near: () => true,
        project(v: THREE.Vector3) { const p = v.clone().project(camera); return { x: (p.x * .5 + .5) * width, y: (-p.y * .5 + .5) * height, visible: p.z < 1 }; } };
      const projectedLabels = new Map<string, HTMLButtonElement>();
      for (const node of [current, ...shown]) {
        const label = button(node.name, () => navigate(node.id)); label.classList.add("proof-label");
        label.title = `${kinds[node.kind]} · ${node.name}`;
        labels.append(label); projectedLabels.set(node.id, label);
      }
      tree.addEventListener("frame", event => {
        const data = (event as CustomEvent<{ tree: { nodes: Array<{ tid: string }> }; proj: Array<{ x: number; y: number; bloomed: boolean; visible: boolean }> } | null>).detail;
        if (!data) return;
        const placed: Array<{ x: number; y: number; w: number }> = [];
        data.tree.nodes.map((node, i) => ({ node, p: data.proj[i] })).sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x).forEach(({ node, p }) => {
          const label = projectedLabels.get(node.tid); if (!label) return;
          label.hidden = !p.bloomed || !p.visible;
          if (label.hidden) return;
          const w = Math.min(150, Math.max(50, label.offsetWidth));
          const x = Math.max(w / 2 + 6, Math.min(width - w / 2 - 6, p.x));
          let y = Math.max(4, p.y + 13);
          for (let attempt = 0; attempt < 12; attempt++) {
            if (!placed.some(box => Math.abs(box.x - x) < (box.w + w) / 2 + 8 && Math.abs(box.y - y) < 30)) break;
            y += 32;
          }
          y = Math.min(height - 30, y);
          placed.push({ x, y, w });
          label.style.transform = `translate(${x}px,${y}px) translateX(-50%)`;
        });
      });
      tree.addEventListener("pick", event => navigate((event as CustomEvent<string>).detail));
      canvas.addEventListener("pointermove", event => { const rect = canvas.getBoundingClientRect(); stage.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top, inside: true }; tree.onPointerMove(stage); }, { signal: abort.signal });
      canvas.addEventListener("pointerleave", () => { stage.pointer.inside = false; }, { signal: abort.signal });
      canvas.addEventListener("pointerdown", () => tree.onPointerDown(stage), { signal: abort.signal });
      canvas.addEventListener("pointerup", () => tree.onPointerUp(), { signal: abort.signal });
      const palette = () => {
        const css = getComputedStyle(host);
        tree.setWorld({ ink: css.getPropertyValue("--tide-fg").trim() || "#ece7da", hot: css.getPropertyValue("--tide-accent").trim() || "#ff5a1f", hot2: css.getPropertyValue("--tide-muted").trim() || "#7fd8ff", blend: "normal", gridAlpha: 0 });
      };
      palette();
      const theme = new MutationObserver(palette); theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-shell", "data-theme"] });
      tree.grow(current.id);
      const loop = (now: number) => {
        frame = 0;
        if (!running || host.hidden || !isRenderingActive() || document.documentElement.dataset.view === "playing") return;
        const w = Math.max(2, visual.clientWidth), h = Math.max(2, visual.clientHeight);
        if (w !== width || h !== height) { width = w; height = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
        tree.update(last ? Math.min(.05, (now - last) / 1000) : 1 / 60, now / 1000, stage); last = now;
        renderer.render(scene, camera);
        drawTimer = window.setTimeout(() => { drawTimer = 0; frame = requestAnimationFrame(loop); }, document.documentElement.dataset.performance === "vivid" ? 1000 / 60 : 1000 / 30);
      };
      restart = () => { if (!frame && running && isRenderingActive() && !host.hidden && document.documentElement.dataset.view !== "playing") { clearTimeout(drawTimer); drawTimer = 0; last = 0; frame = requestAnimationFrame(loop); } };
      disposeGl = () => { abort.abort(); theme.disconnect(); tree.trees.forEach(t => t.dispose()); renderer.dispose(); labels.replaceChildren(); };
      restart();
    } catch {
      labels.replaceChildren();
      status.textContent += " · 图形不可用，可继续使用右侧目录";
    }
  }
  onShellView(() => restart());
  document.addEventListener("visibilitychange", () => { if (!isRenderingActive()) { cancelAnimationFrame(frame); clearTimeout(drawTimer); drawTimer = 0; frame = 0; } else restart(); });
  return {
    show: (_playlists: readonly PlaylistSummary[], hits: readonly SearchHit[]) => {
      stop(); running = true;
      const catalog = catalogFromPlaylists([{ id: "current", name: "当前播放列表", songs: hits }]);
      nodes = new Map(catalog.nodes.map(n => [n.id, n])); path = ["current"]; page = 0; render();
    }, stop,
  };
}
function button(text: string, click: () => void) { const b = document.createElement("button"); b.type = "button"; b.className = "text-button"; b.textContent = text; b.addEventListener("click", click); return b; }
