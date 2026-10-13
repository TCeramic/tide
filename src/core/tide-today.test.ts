import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SearchHit } from "../shared/contract";
import { buildTideToday, countsAsSkip, isThin, type ListenEvent } from "./tide-today";

function play(id: string, at: number, kind: ListenEvent["kind"] = "play"): ListenEvent {
  return { id, title: id, artist: "潮汐", durationMs: 1000, at, kind };
}

function hit(id: string, playable = true): SearchHit {
  return { id, title: id, artist: "喜欢", durationMs: 1000, playable };
}

describe("tide today", () => {
  it("explains an empty log without calling official recommendations", () => {
    const list = buildTideToday([], [hit("1")]);
    assert.equal(list.hits[0]?.title, "1");
    assert.match(list.message ?? "", /我喜欢的音乐/);
    assert.doesNotMatch(list.message ?? "", /每日推荐|私人雷达/);
    assert.equal(isThin([]), true);
  });

  it("stays empty and explains itself when there is no log and no liked playlist", () => {
    const list = buildTideToday([], []);
    assert.deepEqual(list.hits, []);
    assert.match(list.message ?? "", /我喜欢的音乐/);
  });

  it("ranks local plays above skips and ignores the seed once the log is thick", () => {
    const events = [
      play("1", 1),
      play("1", 2),
      play("2", 3),
      play("2", 4, "skip"),
      play("3", 5),
      play("4", 6),
      play("5", 7),
    ];
    assert.equal(isThin(events), false);
    const list = buildTideToday(events, [hit("9")]);
    assert.deepEqual(list.hits.map((item) => item.id), ["1", "5", "4", "3"]);
    assert.equal(list.message, null);
    assert.equal(list.hits.every((item) => item.playable), true);
  });

  it("fills a thin log from the liked playlist and keeps gray rows", () => {
    const list = buildTideToday([play("1", 1)], [hit("1"), hit("2", false), hit("3")]);
    assert.deepEqual(list.hits.map((item) => [item.id, item.playable]), [
      ["1", true],
      ["2", false],
      ["3", true],
    ]);
    assert.match(list.message ?? "", /我喜欢的音乐/);
  });

  it("counts an early exit while the track is still starting, and not a finished listen", () => {
    assert.equal(countsAsSkip("playing", 29_999), true);
    assert.equal(countsAsSkip("loading", 0), true);
    assert.equal(countsAsSkip("playing", 30_000), false);
    assert.equal(countsAsSkip("paused", 0), false);
  });
});
