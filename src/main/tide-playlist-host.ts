import { dialog, ipcMain, nativeImage } from "electron";
import type { TidePlaylist } from "../shared/contract";
import { TidePlaylistStore } from "./tide-playlists";
import { loopbackJson } from "./session-host";
export function attachTidePlaylists(store:TidePlaylistStore,getPort:()=>number|null){
 const guard=(fn:()=>unknown)=>{try{return fn();}catch(e){return {ok:false,message:e instanceof Error?e.message:"操作失败"};}};
 ipcMain.handle("tide:lists",()=>store.list());
 ipcMain.handle("tide:list-save",(_e,id:unknown,patch:unknown)=>guard(()=>({ok:true,playlist:store.save(typeof id==="string"?id:undefined,patch)})));
 ipcMain.handle("tide:list-add",(_e,id:unknown,hit:unknown)=>guard(()=>({ok:true,playlist:store.add(String(id),hit),message:"已收藏到Tide歌单"})));
 ipcMain.handle("tide:list-remove-song",(_e,id:unknown,song:unknown)=>guard(()=>({ok:true,playlist:store.removeSong(String(id),String(song))})));
 ipcMain.handle("tide:list-delete",(_e,id:unknown)=>guard(()=>{store.delete(String(id));return {ok:true};}));
 ipcMain.handle("tide:list-cover",async()=>{const pick=await dialog.showOpenDialog({title:"选择歌单封面",properties:["openFile"],filters:[{name:"图片",extensions:["png","jpg","jpeg","webp"]}]});if(pick.canceled||!pick.filePaths[0])return null;const image=nativeImage.createFromPath(pick.filePaths[0]);if(image.isEmpty())return null;return "data:image/jpeg;base64,"+image.resize({width:720,height:720,quality:"good"}).toJPEG(85).toString("base64");});
 const syncing=new Map<string,Promise<unknown>>();
 ipcMain.handle("tide:list-sync",(_e,id:unknown)=>{
  const key=String(id);if(syncing.has(key))return syncing.get(key);
  const job=(async()=>{const row=store.get(key);if(!row)return {ok:false,message:"歌单不存在"};
   try{
    // Persist the remote id before the remaining operations, so retry never creates duplicates.
    const created=await loopbackJson(getPort(),"POST","/tide-playlist/link",{cloudId:row.cloudId,name:row.name}) as {ok?:boolean;id?:string;message?:string};
    if(!created?.ok||!created.id)return {ok:false,message:created?.message??"同步失败，请先登录网易云"};
    store.link(key,created.id);
    const latest=store.get(key)!;
    const result=await loopbackJson(getPort(),"POST","/tide-playlist/sync",{...latest,cloudId:created.id}) as {ok?:boolean;message?:string};
    return result?.ok?{ok:true,message:result.message??"已同步",playlist:store.get(key) as TidePlaylist}:{ok:false,message:result?.message??"同步未完成，Tide歌单已保留，可重试"};
   }catch{return {ok:false,message:"同步未完成，Tide歌单已保留，可重试"};}
  })();syncing.set(key,job);void job.finally(()=>syncing.delete(key));return job;
 });
}
