import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fallbackLevels, resolveSongLevel } from "./audio-level";

describe("audio level", () => {
  it("falls back from the chosen level toward standard", () => {
    assert.deepEqual(fallbackLevels("hires"), ["hires", "lossless", "exhigh", "standard"]);
    assert.deepEqual(fallbackLevels("standard"), ["standard"]);
  });

  it("uses the first level that returns a url and stops when login is required", async () => {
    const calls: string[] = [];
    const resolved = await resolveSongLevel("lossless", async (level) => {
      calls.push(level);
      if (level === "lossless") return { url: null, signedOut: false };
      return { url: "https://music.126.net/a.mp3", signedOut: false };
    });
    assert.deepEqual(calls, ["lossless", "exhigh"]);
    assert.equal(resolved.level, "exhigh");
    assert.equal(resolved.requested, "lossless");

    const expired = await resolveSongLevel("hires", async () => ({ url: null, signedOut: true }));
    assert.equal(expired.signedOut, true);
    assert.equal(expired.url, null);
  });
});
