import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SearchHit } from "../shared/contract";
import { PLAYLIST_CAP, loadPlaylistPages } from "./playlist-pages";

function hit(id: string): SearchHit {
  return { id, title: id, artist: "潮汐", durationMs: 1000, playable: true };
}

describe("playlist pages", () => {
  it("walks offset pages until a short page and keeps the later tracks", async () => {
    const offsets: number[] = [];
    const hits = await loadPlaylistPages(async (offset, limit) => {
      offsets.push(offset);
      assert.equal(limit, 100);
      if (offset === 0) return Array.from({ length: 100 }, (_, index) => hit(String(index + 1)));
      if (offset === 100) return [hit("101"), hit("102")];
      return [hit("999")];
    });
    assert.deepEqual(offsets, [0, 100]);
    assert.equal(hits.length, 102);
    assert.equal(hits[100]?.id, "101");
    assert.equal(hits.at(-1)?.id, "102");
  });

  it("stops when a page repeats ids and caps near 2000", async () => {
    const repeated = await loadPlaylistPages(async () => [hit("1"), hit("1")]);
    assert.deepEqual(repeated.map((item) => item.id), ["1"]);

    const capped = await loadPlaylistPages(async (offset) => {
      return Array.from({ length: 100 }, (_, index) => hit(String(offset + index + 1)));
    }, 250);
    assert.equal(capped.length, 250);
    assert.equal(capped[249]?.id, "250");
    assert.ok(PLAYLIST_CAP >= 2000);
  });
});
