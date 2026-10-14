import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentLyricIndex, deskLineCue, lyricPosition, nextLyricOffset, pairLyrics, parseLrc } from "./lyrics";

describe("lyrics", () => {
  it("parses stamps and follows the playhead", () => {
    const lines = parseLrc("[00:01.00]第一句\n[00:05.50]第二句\n无时间\n");
    assert.deepEqual(lines.map((line) => line.text), ["第一句", "第二句"]);
    assert.equal(currentLyricIndex(lines, 0), -1);
    assert.equal(currentLyricIndex(lines, 1000), 0);
    assert.equal(currentLyricIndex(lines, 6000), 1);
  });

  it("steps the lyric offset by half a second and applies it to the playhead", () => {
    const lines = parseLrc("[00:01.00]第一句\n[00:02.00]第二句\n");
    assert.equal(nextLyricOffset(0, 1), 500);
    assert.equal(nextLyricOffset(10_000, 1), 10_000);
    assert.equal(currentLyricIndex(lines, lyricPosition(1600, 500)), 1);
    assert.equal(currentLyricIndex(lines, lyricPosition(2000, -500)), 0);
  });

  it("accepts a missing lyric", () => {
    assert.deepEqual(parseLrc(""), []);
    assert.deepEqual(parseLrc(null), []);
  });

  it("stacks a nearby translation and leaves a far one off the line", () => {
    const original = parseLrc("[00:01.00]原文\n[00:05.00]下一句\n");
    const translation = parseLrc("[00:01.20]译文\n[00:09.00]太远\n");
    const pairs = pairLyrics(original, translation);
    assert.equal(pairs[0]?.translation, "译文");
    assert.equal(pairs[1]?.translation, "");
    const early = deskLineCue(original, translation, 0, 0, "歌");
    assert.equal(early.current, "");
    assert.equal(early.next, "原文");
    assert.equal(early.translation, "");
    const current = deskLineCue(original, translation, 1100, 0, "歌");
    assert.equal(current.current, "原文");
    assert.equal(current.translation, "译文");
    assert.equal(current.next, "下一句");
    assert.equal(deskLineCue([], [], 0, 0, "歌").empty, true);
  });
});
