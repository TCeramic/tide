import type { TidePlaylist } from "../../shared/contract";
export function editTidePlaylist(row:TidePlaylist|undefined,saved:(id:string)=>Promise<void>){
 const overlay=document.createElement("div");overlay.className="playlist-editor-backdrop";
 const form=document.createElement("form");form.className="playlist-editor glass";form.setAttribute("role","dialog");form.setAttribute("aria-modal","true");form.setAttribute("aria-label",row?"编辑Tide歌单":"创建Tide歌单");
 const title=document.createElement("h2");title.textContent=row?"编辑歌单":"创建Tide歌单";
 const name=document.createElement("input");name.value=row?.name??"";name.required=true;name.maxLength=100;name.placeholder="歌单名称";name.setAttribute("aria-label","歌单名称");
 const description=document.createElement("textarea");description.value=row?.description??"";description.maxLength=2000;description.rows=4;description.placeholder="歌单描述";description.setAttribute("aria-label","歌单描述");
 const art=document.createElement("img");art.alt="";art.src=row?.cover??"./assets/today-tide.png";let cover=row?.cover;
 const note=document.createElement("p");note.className="library-note";
 const close=()=>{overlay.remove();document.removeEventListener("keydown",escape);};const escape=(e:KeyboardEvent)=>{if(e.key==="Escape")close();};document.addEventListener("keydown",escape);
 const choose=button("更换封面",async()=>{const next=await window.tide.pickPlaylistCover();if(next){cover=next;art.src=next;}});
 const cancel=button("取消",close),save=document.createElement("button");save.type="submit";save.textContent="保存歌单";save.className="text-button";
 const actions=document.createElement("div");actions.className="playlist-editor-actions";actions.append(cancel,save);
 form.addEventListener("submit",async e=>{e.preventDefault();save.disabled=true;const result=await window.tide.saveTidePlaylist(row?.id,{name:name.value,description:description.value,cover});save.disabled=false;if(!result.ok){note.textContent=result.message;return;}await saved(result.playlist.id);close();});
 form.append(title,art,choose,name,description,note,actions);overlay.append(form);document.body.append(overlay);overlay.addEventListener("pointerdown",e=>{if(e.target===overlay)close();});name.focus();
}
function button(label:string,action:()=>void){const b=document.createElement("button");b.type="button";b.className="text-button";b.textContent=label;b.onclick=action;return b;}
