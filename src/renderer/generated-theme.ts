import { themeFromPixels, type GeneratedTheme } from "../core/generated-theme";
import { normalizeArtworkUrl } from "../core/artwork";
import type { CustomPalette } from "../shared/contract";
let custom: CustomPalette | undefined, automatic: GeneratedTheme | undefined, customKey="";
export function setCustomPalette(palette?: CustomPalette): void {
 const key=JSON.stringify(palette??null);if(key===customKey)return;customKey=key;
 custom=palette;
 const root=document.documentElement;
 root.dataset.customColors=String(Boolean(custom?.enabled));
 for(const key of ['accent','text','muted','points','panel'] as const){
  if(custom?.enabled)root.style.setProperty('--custom-'+key,custom[key]);else root.style.removeProperty('--custom-'+key);
 }
 if(custom?.enabled){const rgb=custom.panel.slice(1).match(/../g)!.map(v=>parseInt(v,16));root.style.setProperty('--custom-surface',`rgba(${rgb.join(',')},${custom.panelOpacity})`);}else root.style.removeProperty('--custom-surface');
 if(automatic)applyGeneratedTheme(automatic);
 else if(custom?.enabled)applyGeneratedTheme({name:'自定义',colors:custom.colors,accent:custom.accent,source:'local'});
}
const CACHE_KEY="tide.cover-themes.v2",MAX_THEMES=600;
let generation=0,currentId="",currentKey="";
const cache=new Map<string,GeneratedTheme>();
try{const saved=JSON.parse(localStorage.getItem(CACHE_KEY)??"[]");if(Array.isArray(saved))for(const [id,t]of saved.slice(-MAX_THEMES))if(typeof id==="string"&&valid(t))cache.set(id,t);}catch{}
function valid(t:unknown):t is GeneratedTheme{const v=t as GeneratedTheme;return Boolean(v&&Array.isArray(v.colors)&&v.colors.length>=2&&v.colors.length<=8&&v.colors.every(c=>/^#[a-f0-9]{6}$/i.test(c))&&/^#[a-f0-9]{6}$/i.test(v.accent));}
function save(id:string,theme:GeneratedTheme){cache.delete(id);cache.set(id,theme);while(cache.size>MAX_THEMES)cache.delete(cache.keys().next().value!);try{localStorage.setItem(CACHE_KEY,JSON.stringify([...cache]));}catch{}}
export function applyGeneratedTheme(theme: GeneratedTheme): void {
 automatic=theme;
 if(custom?.enabled)theme={...theme,colors:custom.colors,accent:custom.accent};
 document.documentElement.style.setProperty("--generated-colors",JSON.stringify(theme.colors));document.documentElement.style.setProperty("--cover-tint",theme.accent);document.documentElement.dataset.generatedTheme=theme.source;window.dispatchEvent(new CustomEvent("tide:palette",{detail:theme}));
}
export function replaceCurrentTheme(theme:GeneratedTheme){if(currentId)save(currentId,theme);applyGeneratedTheme(theme);}
export function updateCoverTheme(id:string,cover:string|undefined,title:string,force=false):void{
 const stored=cache.get(id),url=normalizeArtworkUrl(cover),key=id+":"+(url??"");
 if(!force&&key===currentKey)return;currentKey=key;
 currentId=id;const token=++generation;
 window.dispatchEvent(new CustomEvent('tide:artwork',{detail:{url:url??'./assets/today-tide.png'}}));
 if(stored&&!force&&(stored.source!=="local"||!url)){applyGeneratedTheme(stored);return;}
 const fallback=themeFromPixels([],title);
 if(!url){save(id,fallback);applyGeneratedTheme(fallback);return;}
 const image=new Image();image.crossOrigin="anonymous";image.referrerPolicy="no-referrer";
 image.onload=()=>{if(token!==generation)return;try{const cv=document.createElement("canvas");cv.width=cv.height=48;const g=cv.getContext("2d",{willReadFrequently:true});if(!g)return;g.drawImage(image,0,0,48,48);const theme=themeFromPixels(g.getImageData(0,0,48,48).data,title);save(id,theme);applyGeneratedTheme(theme);}catch{save(id,fallback);applyGeneratedTheme(fallback);}};
 image.onerror=()=>{if(token===generation){save(id,fallback);applyGeneratedTheme(fallback);}};image.src=url;
}
