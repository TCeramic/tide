import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { TidePlaylistStore } from "./tide-playlists";
it("native playlists preserve metadata and songs across edits, reloads and cloud linking",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"tide-lists-")),file=path.join(dir,"lists.json");
 try{const store=new TidePlaylistStore(file),row=store.save(undefined,{name:"测试",description:"描述",cover:"https://example.com/cover.jpg"});
 const song={id:"123",title:"曲名",artist:"歌手",durationMs:123000,playable:true,cover:"https://example.com/song.jpg"};store.add(row.id,song);store.add(row.id,song);store.link(row.id,"456");
 store.save(row.id,{name:"新名称",cloudId:"999",songs:[]});const saved=new TidePlaylistStore(file).get(row.id)!;
 assert.equal(saved.name,"新名称");assert.equal(saved.description,"描述");assert.equal(saved.cover,row.cover);assert.equal(saved.cloudId,"456");assert.deepEqual(saved.songs,[song]);
 assert.throws(()=>store.add(row.id,{...song,id:"invalid"}));store.removeSong(row.id,song.id);assert.equal(store.get(row.id)?.songs.length,0);store.delete(row.id);assert.deepEqual(store.list(),[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
