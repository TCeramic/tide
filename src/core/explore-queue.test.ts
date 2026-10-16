import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SearchHit } from "../shared/contract";
import { randomProfileMatch, profileSeeds, rankProfileMatches, exploreSeedIds, pickExploreAdditions, shouldExtendQueue, shouldInspireNow } from "./explore-queue";

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

it("samples the whole original playlist and gives liked songs three votes", () => {
  const profile = Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1) }));
  const seeds = profileSeeds(profile, new Set(["100"]));
  assert.ok(seeds.some(s => s.id === "1"));
  assert.ok(seeds.some(s => Number(s.id) >= 50 && Number(s.id) < 80));
  assert.equal(seeds.find(s => s.id === "100")?.weight, 3);
  assert.notDeepEqual(profileSeeds(profile, new Set(), 1), profileSeeds(profile, new Set(), 0));
  const ranked = rankProfileMatches([{ weight: 1, hits: [hit("200")] }, { weight: 3, hits: [hit("201")] }]);
  assert.equal(ranked[0].id, "201");
});

it("draws a single random candidate, preserves weights and skips queued/recent songs", () => {
  const groups = [{ weight: 3, hits: [hit("201")] }, { weight: 1, hits: [hit("202"), hit("203")] }];
  assert.equal(randomProfileMatch(groups, new Set(), new Set(), () => 0)?.id, "201");
  assert.equal(randomProfileMatch(groups, new Set(), new Set(), () => .999)?.id, "203");
  assert.equal(randomProfileMatch(groups, new Set(["201"]), new Set(["202"]), () => 0)?.id, "203");
});
