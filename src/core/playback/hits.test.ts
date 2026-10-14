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

  it("keeps an http cover and drops anything else", () => {
    const row = hit("a", true);
    row.cover = "https://p1.music.126.net/cover.jpg";
    const queued = queueFromHits([row], 0);
    assert.equal(queued?.tracks[0]?.cover, "https://p1.music.126.net/cover.jpg");
    const blocked = hit("b", true);
    blocked.cover = "javascript:alert(1)";
    assert.equal(queueFromHits([blocked], 0)?.tracks[0]?.cover, undefined);
  });

  it("ignores a gray row", () => {
    const hits = [hit("a", true), hit("gray", false)];
    assert.equal(queueFromHits(hits, 1), null);
    assert.equal(queueFromHits(hits, 4), null);
  });
});
