import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentLyricIndex, parseLrc } from "./lyrics";

describe("lyrics", () => {
  it("parses stamps and follows the playhead", () => {
    const lines = parseLrc("[00:01.00]第一句\n[00:05.50]第二句\n无时间\n");
    assert.deepEqual(lines.map((line) => line.text), ["第一句", "第二句"]);
    assert.equal(currentLyricIndex(lines, 0), -1);
    assert.equal(currentLyricIndex(lines, 1000), 0);
    assert.equal(currentLyricIndex(lines, 6000), 1);
  });

  it("accepts a missing lyric", () => {
    assert.deepEqual(parseLrc(""), []);
    assert.deepEqual(parseLrc(null), []);
  });
});
