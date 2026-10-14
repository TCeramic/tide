import * as THREE from "three";
import { catalogFromPlaylists, DEMO_PLAYLISTS, latticeRecords, type ProofPlaylist } from "../../core/proof-catalog";
import type { PlaylistSummary, SearchHit } from "../../shared/contract";
import { ProofTree } from "../vendor/lattice/gl/prooftree.js";

/** Clickable Lattice proof tree. Songs are leaves. WebGL drops to a list on the smooth tier. */
export function mountProof(host: HTMLElement, onSong: (id: string, name: string) => void): {
  show: (playlists: readonly PlaylistSummary[], hits: readonly SearchHit[]) => void;
  stop: () => void;
} {
  const canvas = document.createElement("canvas");
  canvas.className = "proof-canvas";
  const status = document.createElement("p");
  status.className = "proof-status";
  status.textContent = "歌单长成歌手，歌手长成曲。";
  const list = document.createElement("div");
  list.className = "proof-list";
  host.append(canvas, status, list);

  let running = false;
  let frame = 0;
  let renderer: THREE.WebGLRenderer | null = null;
  let tree: ProofTree | null = null;

  const stop = () => {
    running = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    tree = null;
    renderer?.dispose();
    renderer = null;
  };

  const show = (playlists: readonly PlaylistSummary[], hits: readonly SearchHit[]) => {
    stop();
    const source = sourceOf(playlists, hits);
    const catalog = catalogFromPlaylists(source);
    const names = new Map(catalog.nodes.map((node) => [node.id, node]));
    list.replaceChildren();
    const smooth = document.documentElement.dataset.performance === "smooth";
    if (smooth || !startGl(catalog.rootId, latticeRecords(catalog.nodes), names, onSong, status, canvas, (value) => {
      tree = value.tree;
      renderer = value.renderer;
      running = true;
    })) {
      canvas.hidden = true;
      renderList(list, catalog.nodes, catalog.rootId, names, onSong, status);
      status.textContent = smooth ? "流畅档用列表。点曲名可选，双击播放。" : "点阵没有起来，先用列表。";
      return;
    }
    canvas.hidden = false;
    const loop = (now: number) => {
      if (!running || !tree || !renderer) return;
      const stage = stageFor(canvas, renderer);
      tree.update(1 / 60, now / 1000, stage);
      renderer.render(stage.scene, stage.camera);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
  };

  return { show, stop };
}

function sourceOf(playlists: readonly PlaylistSummary[], hits: readonly SearchHit[]): ProofPlaylist[] {
  if (hits.length > 0) {
    return [{
      id: "now",
      name: "当前列表",
      songs: hits.map((hit) => ({ id: hit.id, title: hit.title, artist: hit.artist })),
    }];
  }
  if (playlists.length > 0) {
    return playlists.map((playlist) => ({ id: playlist.id, name: playlist.name, songs: [] }));
  }
  return DEMO_PLAYLISTS;
}

function startGl(
  rootId: string,
  byId: ReturnType<typeof latticeRecords>,
  names: Map<string, { name: string; kind: string }>,
  onSong: (id: string, name: string) => void,
  status: HTMLElement,
  canvas: HTMLCanvasElement,
  keep: (value: { tree: ProofTree; renderer: THREE.WebGLRenderer }) => void,
): boolean {
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
    renderer.setClearColor(0x000000, 0);
    const tree = new ProofTree({ byId: byId as unknown as Map<string, unknown>, station: "tree", ground: true });
    tree.setWorld({ ink: "#ece7da", hot: "#ff5a1f", hot2: "#7fd8ff", blend: "additive", gridAlpha: 0.35 });
    tree.grow(rootId);
    tree.addEventListener("pick", (event) => {
      const id = (event as CustomEvent<string>).detail;
      const node = names.get(id);
      if (!node) return;
      status.textContent = node.name;
      if (node.kind === "song") onSong(id, node.name);
      else tree.grow(id);
    });
    tree.addEventListener("hover", (event) => {
      const detail = (event as CustomEvent<{ t?: { name?: string } } | null>).detail;
      if (detail?.t?.name) status.textContent = detail.t.name;
    });
    const stage = stageFor(canvas, renderer);
    stage.scene.add(tree.object);
    keep({ tree, renderer });
    const pointer = stage.pointer;
    canvas.addEventListener("pointermove", (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.inside = true;
      tree.onPointerMove(stage);
    });
    canvas.addEventListener("pointerdown", () => {
      tree.onPointerDown(stage);
    });
    canvas.addEventListener("pointerup", () => tree.onPointerUp());
    return true;
  } catch {
    return false;
  }
}

const stages = new WeakMap<HTMLCanvasElement, ReturnType<typeof makeStage>>();

function stageFor(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer) {
  let stage = stages.get(canvas);
  if (!stage) {
    stage = makeStage(canvas, renderer);
    stages.set(canvas, stage);
  }
  const width = Math.max(2, canvas.clientWidth);
  const height = Math.max(2, canvas.clientHeight);
  renderer.setSize(width, height, false);
  stage.camera.aspect = width / height;
  stage.camera.updateProjectionMatrix();
  stage.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  return stage;
}

function makeStage(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
  camera.position.set(0.2, 1.8, 6.4);
  camera.lookAt(0, 1.1, 0);
  return {
    scene,
    camera,
    renderer,
    dpr: 1,
    pointer: { x: 0, y: 0, inside: false },
    near: () => true,
    project(vector: THREE.Vector3) {
      const projected = vector.clone().project(camera);
      const rect = canvas.getBoundingClientRect();
      return {
        x: (projected.x * 0.5 + 0.5) * rect.width,
        y: (-projected.y * 0.5 + 0.5) * rect.height,
        visible: projected.z < 1,
      };
    },
  };
}

function renderList(
  list: HTMLElement,
  nodes: readonly { id: string; name: string; kind: string; deps: string[] }[],
  rootId: string,
  names: Map<string, { name: string; kind: string }>,
  onSong: (id: string, name: string) => void,
  status: HTMLElement,
): void {
  const root = nodes.find((node) => node.id === rootId);
  const walk = (id: string, depth: number) => {
    const node = nodes.find((item) => item.id === id);
    if (!node || node.id === rootId && depth > 0) return;
    if (node.kind !== "library") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-button proof-node";
      button.style.paddingLeft = `${12 + depth * 14}px`;
      button.textContent = node.name;
      button.addEventListener("click", () => {
        status.textContent = node.name;
      });
      button.addEventListener("dblclick", () => {
        if (node.kind === "song") onSong(node.id, node.name);
      });
      list.append(button);
    }
    for (const child of node.deps) walk(child, depth + 1);
  };
  if (root) walk(root.id, 0);
  void names;
}
