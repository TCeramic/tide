import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isLocalId } from "../core/local-library";
import type { SearchHit, TidePlaylist } from "../shared/contract";
/** User-owned playlists, independent of cloud availability. Atomic replacement on disk. */
export class TidePlaylistStore {
 constructor(private file:string){}
 list():TidePlaylist[]{try{const parsed=JSON.parse(fs.readFileSync(this.file,"utf8"));return Array.isArray(parsed)?parsed.slice(0,100).flatMap(v=>{const row=readPlaylist(v);return row?[row]:[];}):[];}catch{return [];}}
 get(id:string){return this.list().find(p=>p.id===id)??null;}
 save(id:string|undefined,input:unknown):TidePlaylist{
  const rows=this.list(),prior=rows.find(p=>p.id===id);if(id&&!prior)throw new Error("歌单不存在");if(!prior&&rows.length>=100)throw new Error("最多创建100个Tide歌单");
  const patch=input&&typeof input==="object"?input as Record<string,unknown>:{};
  const row=readPlaylist({...prior,name:typeof patch.name==="string"?patch.name:prior?.name,description:typeof patch.description==="string"?patch.description:prior?.description,cover:typeof patch.cover==="string"?patch.cover:prior?.cover,id:prior?.id??`tide-list-${randomUUID()}`,songs:prior?.songs??[],updatedAt:Date.now()});if(!row)throw new Error("请填写歌单名称");
  this.write(prior?rows.map(p=>p.id===row.id?row:p):[...rows,row]);return row;
 }
 add(id:string,value:unknown){const row=this.get(id);if(!row)throw new Error("歌单不存在");const hit=readHit(value);if(!hit)throw new Error("歌曲信息无效");if(!row.songs.some(h=>h.id===hit.id))row.songs.push(hit);if(row.songs.length>10000)throw new Error("歌单已达到10000首");row.updatedAt=Date.now();this.replace(row);return row;}
 removeSong(id:string,songId:string){const row=this.get(id);if(!row)throw new Error("歌单不存在");row.songs=row.songs.filter(h=>h.id!==songId);row.updatedAt=Date.now();this.replace(row);return row;}
 delete(id:string){this.write(this.list().filter(p=>p.id!==id));}
 link(id:string,cloudId:string){if(!/^\d{1,20}$/.test(cloudId))throw new Error("云端歌单编号无效");const row=this.get(id);if(!row)throw new Error("歌单不存在");row.cloudId=cloudId;this.replace(row);return row;}
 private replace(row:TidePlaylist){this.write(this.list().map(p=>p.id===row.id?row:p));}
 private write(rows:TidePlaylist[]){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+".tmp",JSON.stringify(rows),{encoding:"utf8",mode:0o600});fs.renameSync(this.file+".tmp",this.file);}
}
function readPlaylist(value:unknown):TidePlaylist|null{
 const p=value&&typeof value==="object"?value as Record<string,unknown>:{};if(typeof p.id!=="string"||!/^tide-list-[\w-]+$/.test(p.id)||typeof p.name!=="string"||!p.name.trim())return null;
 const cover=typeof p.cover==="string"&&p.cover.length<1500000&&/^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/.test(p.cover)?p.cover:undefined;
 return {id:p.id,name:p.name.trim().slice(0,100),description:typeof p.description==="string"?p.description.slice(0,2000):"",cover,songs:Array.isArray(p.songs)?p.songs.slice(0,10000).flatMap(v=>{const h=readHit(v);return h?[h]:[];}):[],updatedAt:typeof p.updatedAt==="number"?p.updatedAt:0,...(typeof p.cloudId==="string"&&/^\d{1,20}$/.test(p.cloudId)?{cloudId:p.cloudId}:{})};
}
function readHit(value:unknown):SearchHit|null{
 const p=value&&typeof value==="object"?value as Record<string,unknown>:{};if(typeof p.id!=="string"||!(/^\d{1,20}$/.test(p.id)||isLocalId(p.id))||typeof p.title!=="string"||typeof p.artist!=="string")return null;
 const hit:SearchHit={id:p.id,title:p.title.slice(0,200),artist:p.artist.slice(0,200),durationMs:typeof p.durationMs==="number"&&Number.isFinite(p.durationMs)?Math.max(0,p.durationMs):0,playable:p.playable!==false};
 if(typeof p.cover==="string"&&/^https?:\/\//.test(p.cover))hit.cover=p.cover.slice(0,1000);if(typeof p.albumTitle==="string")hit.albumTitle=p.albumTitle.slice(0,200);if(typeof p.albumId==="string")hit.albumId=p.albumId.slice(0,40);return hit;
}
