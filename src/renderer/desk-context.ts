import type { DeskLyricsSettings } from "../core/desk-lyrics";
export function mountDeskContext(): void {
 const query=new URLSearchParams(location.search),root=document.documentElement;
 root.dataset.context="true";root.dataset.shell=query.get("shell")==="lattice"?"lattice":"lens";root.dataset.colorMode=query.get("mode")==="light"?"light":"dark";
 const menu=document.createElement("section");menu.className="desk-context";menu.setAttribute("aria-label","桌面歌词快捷设置");
 const heading=document.createElement("strong");heading.textContent="桌面歌词";menu.append(heading);
 const checks=new Map<string,HTMLButtonElement>(),choices=new Map<string,HTMLButtonElement>();
 const controls:{input:HTMLInputElement;key:"fontSize"|"opacity"|"glow";scale:number;output:HTMLOutputElement}[]=[];
 let current:DeskLyricsSettings;
 const push=(patch:Partial<DeskLyricsSettings>)=>window.tide.setDeskLyrics(patch).then(paint);
 function check(label:string,key:"locked"|"pair"|"highlightFollow"|"motion"|"wave") {
  const b=document.createElement("button");b.type="button";b.className="desk-context-item";b.textContent=label;b.setAttribute("role","menuitemcheckbox");b.addEventListener("click",()=>{const value=!current[key];void push({[key]:value}).then(()=>{if(key==="locked"&&value)void window.tide.closeDeskMenu();});});checks.set(key,b);menu.append(b);
 }
 function choice(label:string,key:"orientation"|"lineMode",items:[string,string][]) {
  const row=document.createElement("div");row.className="desk-context-choice";const text=document.createElement("span");text.textContent=label;row.append(text);
  for(const [value,name]of items){const b=document.createElement("button");b.type="button";b.textContent=name;b.addEventListener("click",()=>void push({[key]:value} as Partial<DeskLyricsSettings>));choices.set(`${key}:${value}`,b);row.append(b);}menu.append(row);
 }
 function range(label:string,key:"fontSize"|"opacity"|"glow",min:number,max:number,scale=1){const row=document.createElement("label");row.className="desk-context-range";const text=document.createElement("span");text.textContent=label;const input=document.createElement("input");input.type="range";input.min=String(min);input.max=String(max);input.setAttribute("aria-label",label);const output=document.createElement("output");input.addEventListener("input",()=>output.value=input.value);input.addEventListener("change",()=>void push({[key]:Number(input.value)/scale}));controls.push({input,key,scale,output});row.append(text,input,output);menu.append(row);}
 const center=document.createElement("button");center.className="desk-context-item";center.textContent="居中（保留另一方向位置）";center.onclick=()=>void window.tide.centerDeskLyrics();menu.append(center);
 check("鼠标穿透锁定","locked");choice("方向","orientation",[["horizontal","横排"],["vertical","竖排"]]);choice("原文","lineMode",[["single","单行"],["double","双行"]]);check("附带小字翻译","pair");check("高亮跟随","highlightFollow");check("歌词动效","motion");check("字后波形","wave");range("字号","fontSize",18,64);range("透明度","opacity",20,100,100);range("光晕","glow",0,100,100);
 const fontRow=document.createElement("label");fontRow.className="desk-context-choice";const fontText=document.createElement("span");fontText.textContent="字体";const font=document.createElement("select");font.setAttribute("aria-label","快捷字体");for(const [value,name]of [["Microsoft YaHei","微软雅黑"],["SimSun","宋体"],["KaiTi","楷体"],["SimHei","黑体"],["serif","衬线"],["monospace","等宽"]]){const option=document.createElement("option");option.value=value!;option.textContent=name!;font.append(option);}font.addEventListener("change",()=>void push({fontFamily:font.value}));fontRow.append(fontText,font);menu.append(fontRow);
 const close=document.createElement("button");close.type="button";close.className="desk-context-item";close.textContent="隐藏桌面歌词";close.addEventListener("click",()=>void window.tide.setDeskLyrics({open:false}));menu.append(close);
 function paint(settings:DeskLyricsSettings){current=settings;for(const[key,b]of checks)b.setAttribute("aria-checked",String(settings[key as "locked"]));for(const[key,b]of choices){const[field,value]=key.split(":");b.setAttribute("aria-pressed",String(settings[field as "orientation"|"lineMode"]===value));}for(const c of controls){if(document.activeElement!==c.input)c.input.value=String(Math.round(settings[c.key]*c.scale));c.output.value=c.input.value;}font.value=settings.fontFamily;}
 document.body.replaceChildren(menu);window.tide.onDeskState(paint);void window.tide.getDeskLyrics().then(paint);
 document.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();void window.tide.closeDeskMenu();}if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();const nodes=Array.from(menu.querySelectorAll<HTMLElement>("button,input,select")),i=nodes.indexOf(document.activeElement as HTMLElement);nodes[(i+(event.key==="ArrowDown"?1:-1)+nodes.length)%nodes.length]?.focus();}});
}
