import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { TodayStore } from "./today-store";
const list = (id: string) => ({ ok: true as const, hits: [{ id, title: "Song", artist: "Artist", durationMs: 1000, playable: true }], message: null });
it("refresh replaces the persisted daily snapshot and survives recreation", () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"tide-today-")),file=path.join(dir,"today.json"),day=new Date(2026,9,16);
 try {
  const store=new TodayStore(file);store.replace(list("1"),day);store.replace(list("2"),day);
  assert.deepEqual(store.read(day)?.hits.map(h=>h.id),["2"]);
  const restored=new TodayStore(file);assert.deepEqual(restored.read(day)?.hits.map(h=>h.id),["2"]);
  assert.equal(restored.read(new Date(2026,9,17)),null);
  const returned=store.read(day)!;returned.hits[0]!.id="99";assert.equal(store.read(day)?.hits[0]?.id,"2");
  store.replace({ok:true,hits:[],message:null},day);assert.equal(store.read(day)?.hits[0]?.id,"2");
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
