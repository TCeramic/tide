import type { Appearance, CustomPalette } from "../../shared/contract";

/** Draft values only repaint this example. Persist once on Apply. */
export function mountPaletteMenu() {
  let appearance: Appearance | undefined, draft: CustomPalette, anchor: HTMLElement | null = null;
  const abort = new AbortController(), signal = abort.signal;
  const button = document.createElement("button");
  button.type="button"; button.className="text-button palette-open"; button.textContent="主题配色";
  button.setAttribute("aria-expanded","false");
  const menu=document.createElement("section"); menu.className="palette-menu"; menu.hidden=true;
  menu.setAttribute("role","dialog");menu.setAttribute("aria-label","主题配色");
  const header=document.createElement("header"), heading=document.createElement("strong"), close=document.createElement("button");
  heading.textContent="主题配色";close.type="button";close.textContent="×";close.setAttribute("aria-label","关闭调色菜单");header.append(heading,close);
  const preview=document.createElement("div");preview.className="palette-preview";preview.setAttribute("aria-label","配色实时预览");
  const search=document.createElement("div");search.className="palette-example-search";search.textContent="⌕  搜索音乐";
  const card=document.createElement("div");card.className="palette-example-card";
  const art=document.createElement("img");art.src="./assets/today-tide.png";art.alt="";
  const words=document.createElement("div"),title=document.createElement("strong"),lyric=document.createElement("p"),artist=document.createElement("small");
  title.textContent="今日潮汐";lyric.textContent="让旋律随着潮汐流动";artist.textContent="Tide · 示例画面";words.append(title,lyric,artist);card.append(art,words);
  const points=document.createElement("div");points.className="palette-example-points";points.textContent="· · · · · · · · · · · · · · · · · · · ·";
  const dock=document.createElement("div");dock.className="palette-example-dock";dock.textContent="‹    ▶    ›";
  preview.append(search,card,points,dock);
  const fields=document.createElement("div");fields.className="palette-fields";
  const inputs: HTMLInputElement[]=[];
  const specs:[string,(v:string)=>void,()=>string][]=[];
  for(let i=0;i<4;i++)specs.push([`背景色 ${i+1}`,v=>draft.colors[i]=v,()=>draft.colors[i]!]);
  for(const [key,name] of [['accent','强调色'],['text','主要文字'],['muted','次要文字'],['points','点阵'],['panel','模块底色']] as const)specs.push([name,v=>draft[key]=v,()=>draft[key]]);
  for(const [name,set] of specs){const label=document.createElement("label"),input=document.createElement("input"),text=document.createElement("span");text.textContent=name;input.type="color";input.setAttribute("aria-label",name);input.oninput=()=>{set(input.value);paint();};label.append(text,input);fields.append(label);inputs.push(input);}
  const opacityLabel=document.createElement("label");opacityLabel.className="palette-opacity";opacityLabel.textContent="模块不透明度";
  const opacity=document.createElement("input"),opacityValue=document.createElement("output");opacity.type="range";opacity.min="8";opacity.max="92";opacity.setAttribute("aria-label","模块不透明度");opacity.oninput=()=>{draft.panelOpacity=Number(opacity.value)/100;paint();};opacityLabel.append(opacity,opacityValue);
  const footer=document.createElement("footer"),reset=document.createElement("button"),apply=document.createElement("button"),note=document.createElement("p");
  reset.type=apply.type="button";reset.textContent="恢复自动配色";apply.textContent="应用配色";note.className="palette-note";note.textContent="调整后实时预览，应用后保存。";footer.append(reset,apply);
  menu.append(header,preview,fields,opacityLabel,note,footer);document.body.append(menu);
  function paint(){preview.style.background=`linear-gradient(135deg,${draft.colors.join(',')})`;preview.style.color=draft.text;preview.style.setProperty('--preview-accent',draft.accent);preview.style.setProperty('--preview-muted',draft.muted);preview.style.setProperty('--preview-points',draft.points);const rgb=draft.panel.slice(1).match(/../g)!.map(v=>parseInt(v,16));preview.style.setProperty('--preview-panel',`rgba(${rgb.join(',')},${draft.panelOpacity})`);opacityValue.value=Math.round(draft.panelOpacity*100)+"%";}
  function position(){if(!anchor)return;const r=anchor.getBoundingClientRect(),w=Math.min(388,innerWidth-24);menu.style.width=w+'px';menu.style.left=Math.max(12,Math.min(innerWidth-w-12,r.left-w-12))+'px';menu.style.top=Math.max(40,Math.min(innerHeight-menu.offsetHeight-12,r.top))+'px';}
  function hide(){menu.hidden=true;button.setAttribute('aria-expanded','false');}
  button.onclick=()=>{if(!menu.hidden){hide();return;}anchor=button;let colors:string[]=[];try{colors=JSON.parse(document.documentElement.style.getPropertyValue('--generated-colors'));}catch{}const dark=document.documentElement.dataset.colorMode==='dark';
    draft=structuredClone(appearance?.customPalette??{enabled:true,colors:colors.length?colors:['#345f7c','#8c729d','#72a6b5','#b5b5a2'],accent:'#8bd8ff',text:dark?'#f3f7fc':'#173248',muted:dark?'#b6c8d8':'#4c6578',points:dark?'#eef6ff':'#152c42',panel:dark?'#132537':'#e9f3f8',panelOpacity:.46});
    draft.colors=Array.from({length:4},(_,i)=>draft.colors[i%draft.colors.length]!);inputs.forEach((input,i)=>input.value=specs[i]![2]());opacity.value=String(Math.round(draft.panelOpacity*100));note.textContent='调整后实时预览，应用后保存。';paint();menu.hidden=false;position();button.setAttribute('aria-expanded','true');};
  close.onclick=hide;
  async function commit(automatic:boolean){apply.disabled=reset.disabled=true;try{await window.tide.setAppearance(automatic?{customPalette:{...draft,enabled:false}}:{customPalette:{...draft,enabled:true},background:'paper'});hide();}catch{note.textContent='保存失败，请重试。';}finally{apply.disabled=reset.disabled=false;}}
  apply.onclick=()=>void commit(false);reset.onclick=()=>void commit(true);
  document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target as Node)&&!button.contains(e.target as Node))hide();},{signal});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){e.stopPropagation();hide();button.focus();}},{signal});
  window.addEventListener('resize',position,{signal});
  return {button,sync(value:Appearance){appearance=value;},destroy(){abort.abort();menu.remove();}};
}
