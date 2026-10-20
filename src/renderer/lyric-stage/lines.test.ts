import assert from "node:assert/strict";
import test from "node:test";
import type { YrcLine } from "../../shared/contract";
import { toLumiLines } from "./lines";

test("YRC keeps authored long line and word timing beyond ten seconds", () => {
  const yrc: YrcLine[] = [{
    timeMs: 20_000,
    durationMs: 12_400,
    text: "long phrase",
    words: [
      { timeMs: 20_000, durationMs: 5_500, text: "long " },
      { timeMs: 25_500, durationMs: 6_900, text: "phrase" },
    ],
  }];

  const [line] = toLumiLines({ yrc, original: [], translation: [], romanization: [] });

  assert.ok(line);
  assert.equal(line.startTime, 20);
  assert.equal(line.endTime, 32.4);
  assert.equal(line.words[1].startTime, 25.5);
  assert.equal(line.words[1].endTime, 32.4);
});

test("LRC keeps a long gap through the next timestamp and track duration", () => {
  const lines = toLumiLines({
    yrc: [],
    original: [
      { timeMs: 0, text: "first line" },
      { timeMs: 12_000, text: "second line" },
    ],
    translation: [],
    romanization: [],
  }, 28_000);

  assert.equal(lines[0].endTime, 12);
  assert.equal(lines[0].words.at(-1)?.endTime, 12);
  assert.equal(lines[1].endTime, 28);
  assert.equal(lines[1].words.at(-1)?.endTime, 28);
});

test("translations and romanization attach only to nearby timestamps", () => {
  const [line] = toLumiLines({
    yrc: [],
    original: [{ timeMs: 11_000, text: "known line" }],
    translation: [{ timeMs: 10_900, text: "translation" }, { timeMs: 1_000, text: "unrelated" }],
    romanization: [{ timeMs: 12_000, text: "romaji" }],
  }, 20_000);

  assert.equal(line.translation, "translation");
  assert.equal(line.romanization, "romaji");
});
