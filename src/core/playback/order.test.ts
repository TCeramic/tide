import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { followingIndex, previousIndex } from "./order";

describe("playback order", () => {
  it("wraps the list, stops, or stays ready for single repeat", () => {
    assert.equal(followingIndex(3, 1, "all", false), 2);
    assert.equal(followingIndex(3, 2, "all", false), 0);
    assert.equal(followingIndex(3, 2, "off", false), null);
    assert.equal(previousIndex(3, 0, "all"), 2);
    assert.equal(previousIndex(3, 0, "off"), null);
  });

  it("shuffle picks a different index", () => {
    assert.equal(followingIndex(4, 1, "off", true, () => 0), 0);
    assert.equal(followingIndex(4, 1, "off", true, () => 0.99), 3);
    assert.notEqual(followingIndex(4, 1, "off", true, () => 0), 1);
  });
});
