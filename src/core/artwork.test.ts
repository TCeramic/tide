import assert from "node:assert/strict";
import { it } from "node:test";
import { normalizeArtworkUrl } from "./artwork";
import { createNeteaseClient, readAlbum, readCatalog, readCoverUrl } from "../api/netease";

it("normalizes NetEase artwork for the renderer CSP and rejects unsafe URLs", () => {
  assert.equal(normalizeArtworkUrl(" http://p1.music.126.net/a.jpg "), "https://p1.music.126.net/a.jpg");
  assert.equal(normalizeArtworkUrl("//p2.music.126.net/a.jpg"), "https://p2.music.126.net/a.jpg");
  for (const value of [null, "javascript:alert(1)", "file:///a", "https://user:pass@example.test/a", "x".repeat(2049)]) {
    assert.equal(normalizeArtworkUrl(value), null);
  }
  assert.equal(readCoverUrl({ al: { picUrl: "bad" }, album: { picUrl: "http://p1.music.126.net/fallback.jpg" } }), "https://p1.music.126.net/fallback.jpg");
});

it("preserves album search art and uses parent album art for songs without it", () => {
  const cover = "https://p1.music.126.net/album.jpg";
  const catalog = readCatalog({ body: { code: 200, result: { albums: [{ id: 2, name: "专辑", picUrl: cover, artist: { name: "歌手" } }] } } }, 10);
  assert.equal(catalog.albums[0]?.cover, cover);
  const tracks = readAlbum({ body: { code: 200, album: { picUrl: cover }, songs: [{ id: 1, name: "歌曲", dt: 1000, ar: [{ name: "歌手" }] }] } });
  assert.equal(tracks[0]?.cover, cover);
});

it("batches missing song art, caches it, and preserves play privileges", async () => {
  const calls: string[] = [];
  const client = createNeteaseClient({
    async cloudsearch() { return { body: { code: 200, result: { songs: [{ id: 1, name: "歌曲", dt: 1000, ar: [{ name: "歌手" }], privilege: { st: -1, pl: 0 } }] } } }; },
    async song_detail(query: { ids: string }) {
      calls.push(query.ids);
      return { body: { code: 200, songs: [{ id: 1, name: "歌曲", al: { picUrl: "http://p1.music.126.net/song.jpg" } }] } };
    },
  } as never);
  const first = await client.search("歌曲", null);
  assert.equal(first[0]?.cover, "https://p1.music.126.net/song.jpg");
  assert.equal(first[0]?.playable, false);
  assert.deepEqual(await client.search("歌曲", null), first);
  assert.deepEqual(calls, ["1"]);
});

it("keeps usable song results when artwork detail lookup fails", async () => {
  const client = createNeteaseClient({
    async cloudsearch() { return { body: { code: 200, result: { songs: [{ id: 1, name: "歌曲", dt: 1000 }] } } }; },
    async song_detail() { throw new Error("offline"); },
  } as never);
  assert.equal((await client.search("歌曲", null))[0]?.title, "歌曲");
});
