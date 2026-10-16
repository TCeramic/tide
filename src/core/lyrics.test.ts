import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentLyricIndex, deskLineCue, immersiveProgress, lineEase, lyricPosition, nextLyricOffset, pairLyrics, parseLrc, parseYrc, sweepProgress } from "./lyrics";

describe("lyrics", () => {
  it("honors file offsets and multi-stamp lines while rejecting invalid seconds", () => {
    assert.deepEqual(parseLrc("[offset:-500]\n[00:01.000][00:02.000]同一句\n[00:99.000]坏时间").map(row => row.timeMs), [500, 1500]);
  });
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
    const credit = pairLyrics(
      parseLrc("[00:01.00]作词：潮汐\n[00:05.00]下一句\n"),
      parseLrc("[00:01.10]Lyricist\n[00:05.10]下一句译文\n"),
    );
    assert.equal(credit[0]?.translation, "");
    assert.equal(credit[1]?.translation, "下一句译文");
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

  it("parses yrc words and sweeps by measured width", () => {
    const lines = parseYrc([
      "{\"t\":0,\"c\":[{\"tx\":\"作词\"}]}",
      "[16210,3460](16210,670,0)还(16880,410,0)没",
      "[10000,2000](0,500,0)你",
      "not a line",
    ].join("\n"));
    assert.equal(lines.length, 2);
    assert.equal(lines[1]?.text, "还没");
    assert.equal(lines[1]?.words.length, 2);
    assert.equal(lines[0]?.words[0]?.timeMs, 10000);
    const words = lines[1]?.words ?? [];
    assert.equal(sweepProgress(words, [20, 10], 16210), 0);
    const mid = sweepProgress(words, [20, 10], 16210 + 335);
    assert.ok(mid > 0.3 && mid < 0.4);
    assert.equal(sweepProgress(words, [20, 10], 16880 + 410), 1);
    assert.equal(lineEase(0, 1000, 2000), 0);
    assert.ok(lineEase(1500, 1000, 2000) > 0.4 && lineEase(1500, 1000, 2000) < 0.6);
    assert.equal(parseYrc("").length, 0);
  });

  it("reports a real word sweep and refuses to fake one on a plain line", () => {
    const yrc = parseYrc("[1000,2000](1000,1000,0)潮(2000,1000,0)汐");
    const mid = immersiveProgress(yrc, [], 1500);
    assert.equal(mid.text, "潮汐");
    assert.equal(mid.wordLevel, true);
    assert.ok(mid.progress > 0.2 && mid.progress < 0.6);
    const plain = immersiveProgress([], parseLrc("[00:01.00]整行"), 1500);
    assert.equal(plain.text, "整行");
    assert.equal(plain.wordLevel, false);
    assert.equal(plain.progress, 1);
    assert.equal(immersiveProgress([], [], 0).text, "");
  });
});
