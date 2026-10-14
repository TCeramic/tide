import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SearchHit } from "../shared/contract";
import { exploreSeedIds, pickExploreAdditions, shouldExtendQueue, shouldInspireNow } from "./explore-queue";

function hit(id: string, playable = true): SearchHit {
  return { id, title: id, artist: "相似", durationMs: 1000, playable };
}

describe("explore queue", () => {
  it("extends only near the end and seeds from the current track plus recent ones", () => {
    assert.equal(shouldExtendQueue(10, 2), false);
    assert.equal(shouldExtendQueue(10, 6), true);
    assert.deepEqual(exploreSeedIds(["a", "b", "c", "d", "e"], 4), ["e", "d", "c", "b"]);
  });

  it("appends playable similar songs and ignores a daily-recommend shaped list", () => {
    const daily = [hit("9001"), hit("9002")];
    const similar = [hit("101"), hit("50", true), hit("7", false), hit("not-a-song"), hit("102")];
    const added = pickExploreAdditions(similar, new Set(["50"]));
    assert.deepEqual(added.map((item) => item.id), ["101", "102"]);
    assert.equal(added.some((item) => daily.some((row) => row.id === item.id)), false);
  });

  it("continues in order only after the playlist, and shuffle before the end", () => {
    assert.equal(shouldInspireNow(10, 4, "off", false, true), false);
    assert.equal(shouldInspireNow(10, 9, "off", false, true), true);
    assert.equal(shouldInspireNow(10, 9, "all", false, true), false);
    assert.equal(shouldInspireNow(10, 6, "off", true, true), true);
    assert.equal(shouldInspireNow(10, 2, "off", true, true), false);
    assert.equal(shouldInspireNow(10, 9, "off", true, false), false);
    assert.equal(shouldInspireNow(8, 5, "one", true, true), true);
  });
});
