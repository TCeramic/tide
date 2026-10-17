import { isRenderingActive } from "../render-activity";
import { onShellView } from "../view";
import * as THREE from "three";
import { catalogFromPlaylists, type LatticeNode } from "../../core/proof-catalog";
import type { PlaylistSummary, SearchHit } from "../../shared/contract";
import { branchGraph, retractBranches } from "./proof-branches";
import { ProofTree } from "../vendor/design-systems/lattice/src/gl/prooftree.js";

const kinds = { library: "音乐", playlist: "播放列表", artist: "歌手", album: "专辑", song: "单曲" };
const PAGE_SIZE = 8;

/** Original MIT renderer, with a persistent root and bounded, expanding branches. */
export function mountProof(host: HTMLElement, onSong: (id: string, name: string) => void, onExit: () => void) {
  host.setAttribute("aria-label", "音乐脉络");
  const header = document.createElement("header");
  header.className = "proof-header";
  const exit = button("← 返回主页", onExit);
  exit.classList.add("proof-exit");
  const title = document.createElement("h2");
  title.textContent = "音乐脉络";
  const up = button("返回上一级", () => { if (path.length > 1) { path.pop(); render(); } });
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
  const search=document.createElement("input");search.type="search";search.className="proof-search";search.placeholder="搜索歌手、专辑或歌曲";search.setAttribute("aria-label","搜索音乐脉络");
  search.addEventListener("input",()=>{const state=level();state.query=search.value;state.page=0;render();});
  aside.append(search,status, list, pager);
  body.append(visual, aside);
  host.append(header, crumbs, body);
  let nodes = new Map<string, LatticeNode>();
  let path: string[] = [];
  const levels=new Map<string,{page:number;query:string}>();
  const positions=new Map<string,THREE.Vector3>();
  const level=()=>{const id=path.at(-1)!;let state=levels.get(id);if(!state){state={page:0,query:""};levels.set(id,state);}return state;};
  const childrenOf=(id:string)=>{const state=levels.get(id),q=state?.query.trim().toLocaleLowerCase()??"";const matches=(key:string):boolean=>{const n=nodes.get(key)!;return n.name.toLocaleLowerCase().includes(q)||n.deps.some(matches);};return nodes.get(id)!.deps.filter(key=>!q||matches(key)).map(key=>nodes.get(key)!);};
  const records=()=>{const result:LatticeNode[]=[];path.forEach((id,i)=>{const children=childrenOf(id),state=levels.get(id),page=state?.page??0;const shown=children.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);const selected=path[i+1];if(selected&&!shown.some(n=>n.id===selected))shown.push(nodes.get(selected)!);result.push({...nodes.get(id)!,deps:shown.map(n=>n.id)});for(const n of shown)if(n.id!==selected)result.push({...n,deps:[],leaf:true});});return result;};
  let frame = 0, drawTimer = 0;
  let disposeGl = () => {};
  let running = false;
  let restart = () => {};
  let refreshGraph:((records:LatticeNode[])=>void)|null=null;

  function stopGl() { cancelAnimationFrame(frame); clearTimeout(drawTimer); drawTimer = 0; frame = 0; disposeGl(); disposeGl = () => {};refreshGraph=null; }
  function stop() { running = false; stopGl(); }
  function navigate(id: string) {
    const node = nodes.get(id);
    if (!node) return;
    if (node.kind === "song") { onSong(node.songId!, node.name); return; }
    if (id === path.at(-1)) return;
    const prior=path.indexOf(id);path=prior>=0?path.slice(0,prior+1):[...path.filter(key=>id.startsWith(key+"/")),id];render();
  }
  function render() {
    const current = nodes.get(path.at(-1)!);
    if (!current) return;
    up.disabled = path.length < 2;
    crumbs.replaceChildren(...path.map((id, index) => button(nodes.get(id)!.name, () => {
      path = path.slice(0, index + 1); render();
    })));
    const state=level();search.value=state.query;
    const children=childrenOf(current.id);state.page=Math.min(state.page,Math.max(0,Math.ceil(children.length/PAGE_SIZE)-1));const page=state.page;
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
      const prev = button("上一组", () => { state.page--; render(); }); prev.disabled = page === 0;
      const next = button("下一组", () => { state.page++; render(); }); next.disabled = (page + 1) * PAGE_SIZE >= children.length;
      const count = document.createElement("span"); count.textContent = `${page + 1} / ${Math.ceil(children.length / PAGE_SIZE)}`;
      pager.append(prev, count, next);
    }
    const graph=records();
    if(refreshGraph){refreshGraph(graph);restart();return;}
    labels.replaceChildren();
    if (!isRenderingActive() || host.hidden) return;
    try {
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
      camera.position.set(0, 1, 3.5); camera.lookAt(0, 1, 0);
      const tree = new ProofTree({ byId: new Map(), station: "tree", ground: false });
      tree.shared.uSize.value = 1.2;
      scene.add(tree.object);
      const abort = new AbortController();
      let width = 0, height = 0, last = 0;
      const stage = { scene, camera, renderer, dpr: renderer.getPixelRatio(), pointer: { x: 0, y: 0, inside: false }, near: () => true,
        project(v: THREE.Vector3) { const p = v.clone().project(camera); return { x: (p.x * .5 + .5) * width, y: (-p.y * .5 + .5) * height, visible: p.z < 1 }; } };
      const projectedLabels = new Map<string, HTMLButtonElement>();
      const labelWidths = new Map<string, number>();
      let cameraY=1,cameraZ=3.5,goalY=1,goalZ=3.5;
      let projected: Array<{x:number;y:number;bloomed:boolean;visible:boolean}>=[];
      const fitTree=()=>{const rows=tree.current?.nodes??[];if(!rows.length)return;const min=Math.min(...rows.map(n=>n.pos.y)),max=Math.max(...rows.map(n=>n.pos.y)),radius=Math.max(...rows.map(n=>Math.hypot(n.pos.x,n.pos.z)))+.3;goalY=(min+max)/2;goalZ=Math.max(3.5,((max-min)/2+.4)/Math.tan(21*Math.PI/180),radius/(Math.tan(21*Math.PI/180)*Math.max(.4,width/Math.max(1,height))))*1.12;};
      let pending:{records:LatticeNode[];started:number;keep:Set<string>}|null=null;
      const motion=()=>document.documentElement.dataset.performance!=="smooth"&&!matchMedia("(prefers-reduced-motion: reduce)").matches;
      const commitGraph=(rows:LatticeNode[])=>{
        branchGraph(tree,rows,positions,path,motion());labels.replaceChildren();projectedLabels.clear();labelWidths.clear();
        for(const node of rows){const label=button(node.name,()=>navigate(node.id));label.classList.add("proof-label");label.title=`${kinds[node.kind]} · ${node.name}`;
          label.style.opacity=path.length>1&&!path.includes(node.id)&&!node.id.startsWith(path.at(-1)!+'/')?'.3':'1';labels.append(label);projectedLabels.set(node.id,label);}
        canvas.dataset.nodes=String(rows.length);canvas.dataset.root=rows[0].id;
        fitTree();
      };
      refreshGraph=rows=>{const keep=new Set(rows.map(n=>n.id));if(motion()&&tree.current?.nodes.some(n=>!keep.has(n.tid)))pending={records:rows,started:performance.now(),keep};else{pending=null;commitGraph(rows);}};
      commitGraph(graph);
      tree.addEventListener("frame", event => {
        const data = (event as CustomEvent<{ tree: { nodes: Array<{ tid: string }> }; proj: Array<{ x: number; y: number; bloomed: boolean; visible: boolean }> } | null>).detail;
        if (!data) return;
        projected=data.proj;
        const placed: Array<{ x: number; y: number; w: number }> = [];
        data.tree.nodes.map((node, i) => ({ node, p: data.proj[i] })).sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x).forEach(({ node, p }) => {
          const label = projectedLabels.get(node.tid); if (!label) return;
          label.hidden = !p.bloomed || !p.visible;
          if (label.hidden) return;
          let w = labelWidths.get(node.tid);
          if (w === undefined) { w = Math.min(150, Math.max(50, label.offsetWidth)); labelWidths.set(node.tid, w); }
          const x = Math.max(w / 2 + 6, Math.min(width - w / 2 - 6, p.x));
          let y=Math.max(4,Math.min(height-30,p.y+13));
          let settled=false;
          for(let step=0;step<Math.ceil(height/32);step++){
            for(const offset of step===0?[0]:[step*32,-step*32]){const candidate=y+offset;
              if(candidate<4||candidate>height-30)continue;
              if(!placed.some(box=>Math.abs(box.x-x)<(box.w+w)/2+8&&Math.abs(box.y-candidate)<30)){y=candidate;settled=true;break;}}
            if(settled)break;
          }
          if(!settled){label.hidden=true;return;}
          placed.push({ x, y, w });
          label.style.transform = `translate(${x}px,${y}px) translateX(-50%)`;
        });
      });
      tree.addEventListener("pick", event => navigate((event as CustomEvent<string>).detail));
      canvas.addEventListener("pointermove", event => { const rect = canvas.getBoundingClientRect(); stage.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top, inside: true }; tree.onPointerMove(stage);restart(); }, { signal: abort.signal });
      canvas.addEventListener("pointerleave", () => { stage.pointer.inside = false; }, { signal: abort.signal });
      canvas.addEventListener("pointerdown", event => {const rect=canvas.getBoundingClientRect();stage.pointer={x:event.clientX-rect.left,y:event.clientY-rect.top,inside:true};let best:number|null=null,distance=34*34;projected.forEach((p,i)=>{const d=(p.x-stage.pointer.x)**2+(p.y-stage.pointer.y)**2;if(p.visible&&p.bloomed&&d<distance){best=i;distance=d;}});tree.hover=best;tree.onPointerDown(stage);}, { signal: abort.signal });
      canvas.addEventListener("pointerup", () => tree.onPointerUp(), { signal: abort.signal });
      const palette = () => {
        const css = getComputedStyle(host);
        tree.setWorld({ ink: css.getPropertyValue("--tide-fg").trim() || "#ece7da", hot: css.getPropertyValue("--tide-accent").trim() || "#ff5a1f", hot2: css.getPropertyValue("--tide-muted").trim() || "#7fd8ff", blend: "normal", gridAlpha: 0 });
      };
      palette();
      const theme = new MutationObserver(()=>{palette();restart();}); theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-shell", "data-theme", "data-color-mode", "data-world"] });

      const loop = (now: number) => {
        frame = 0;
        if (!running || host.hidden || !isRenderingActive() || document.documentElement.dataset.view === "playing") return;
        if(last&&document.documentElement.dataset.performance==="vivid"&&now-last<1000/120-.5){frame=requestAnimationFrame(loop);return;}
        const w = Math.max(2, visual.clientWidth), h = Math.max(2, visual.clientHeight);
        if (w !== width || h !== height) { width = w; height = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();fitTree(); }
        const ease=motion()?1-Math.exp(-Math.min(.05,last?(now-last)/1000:1/60)*8):1;cameraY+=(goalY-cameraY)*ease;cameraZ+=(goalZ-cameraZ)*ease;camera.position.set(0,cameraY,cameraZ);camera.lookAt(0,cameraY,0);camera.updateMatrixWorld();scene.updateMatrixWorld(true);
        if(pending){const amount=Math.min(1,(now-pending.started)/360);retractBranches(tree.current,pending.keep,amount);if(amount===1){const rows=pending.records;pending=null;commitGraph(rows);}}
        tree.update(last ? Math.min(.05, (now - last) / 1000) : 1 / 60, now / 1000, stage); last = now;
        renderer.render(scene, camera);
        const tier=document.documentElement.dataset.performance;
        if(tier==="smooth"&&!pending)return;
        if(tier==="vivid")frame=requestAnimationFrame(loop);else drawTimer=window.setTimeout(()=>{drawTimer=0;frame=requestAnimationFrame(loop);},1000/30);
      };
      restart = () => { if (!frame && running && isRenderingActive() && !host.hidden && document.documentElement.dataset.view !== "playing") { clearTimeout(drawTimer); drawTimer = 0; last = 0; frame = requestAnimationFrame(loop); } };
      disposeGl = () => { abort.abort(); theme.disconnect(); tree.trees.forEach(t => t.dispose()); renderer.dispose(); labels.replaceChildren(); };
      const resize=new ResizeObserver(()=>{labelWidths.clear();restart();});resize.observe(visual);
      const cleanup=disposeGl;disposeGl=()=>{resize.disconnect();cleanup();};
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
      nodes = new Map(catalog.nodes.map(n => [n.id, n])); path = ["current"];levels.clear();positions.clear();render();
    }, stop,
  };
}
function button(text: string, click: () => void) { const b = document.createElement("button"); b.type = "button"; b.className = "text-button"; b.textContent = text; b.addEventListener("click", click); return b; }
