import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SearchHit } from "../../shared/contract";
import { queueFromHits } from "./hits";

function hit(id: string, playable: boolean): SearchHit {
  return { id, title: id, artist: "潮汐", durationMs: 1000, playable };
}

describe("queueFromHits", () => {
  it("keeps only playable tracks and maps the clicked index", () => {
    const hits = [hit("gray", false), hit("a", true), hit("also", false), hit("b", true)];
    assert.deepEqual(queueFromHits(hits, 3), {
      tracks: [
        { id: "a", title: "a", artist: "潮汐", durationMs: 1000 },
        { id: "b", title: "b", artist: "潮汐", durationMs: 1000 },
      ],
      index: 1,
    });
  });

  it("ignores a gray row", () => {
    const hits = [hit("a", true), hit("gray", false)];
    assert.equal(queueFromHits(hits, 1), null);
    assert.equal(queueFromHits(hits, 4), null);
  });
});
