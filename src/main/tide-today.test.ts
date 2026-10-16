import assert from "node:assert/strict";
import { it } from "node:test";
import { readTideHits } from "../core/tide-today";
import { buildTideToday } from "../core/tide-today";

it("today keeps artwork and like state across the IPC adapter", () => {
  const hit = readTideHits({ ok: true, hits: [{ id: "1", title: "歌曲", artist: "歌手", durationMs: 1000, playable: true, cover: "http://p1.music.126.net/a.jpg", liked: true }] })[0];
  assert.equal(hit?.cover, "https://p1.music.126.net/a.jpg"); assert.equal(hit?.liked, true);
});
it("heard rows keep the stored cover instead of rebuilding blank metadata", () => {
  const hits = buildTideToday([{ id: "1", title: "歌曲", artist: "歌手", durationMs: 1000, at: 1, kind: "play", cover: "https://p1.music.126.net/a.jpg" }]).hits;
  assert.equal(hits[0]?.cover, "https://p1.music.126.net/a.jpg");
});
