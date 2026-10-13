import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Track } from "./types";
import { moveQueueItem, removeQueueItem } from "./queue-edit";

function track(id: string): Track {
  return { id, title: id, artist: "潮汐", durationMs: 1000 };
}

describe("queue edit", () => {
  it("removes a later row, the current row, and clears the last one", () => {
    const queue = [track("a"), track("b"), track("c")];
    const later = removeQueueItem(queue, 0, 2);
    assert.deepEqual(later?.queue.map((item) => item.id), ["a", "b"]);
    assert.equal(later?.index, 0);
    assert.equal(later?.trackChanged, false);

    const current = removeQueueItem(queue, 1, 1);
    assert.deepEqual(current?.queue.map((item) => item.id), ["a", "c"]);
    assert.equal(current?.index, 1);
    assert.equal(current?.trackChanged, true);

    const only = removeQueueItem([track("a")], 0, 0);
    assert.deepEqual(only, { queue: [], index: -1, trackChanged: true });
  });

  it("reorders and keeps the playhead on the same track", () => {
    const queue = [track("a"), track("b"), track("c")];
    const moved = moveQueueItem(queue, 0, 0, 2);
    assert.deepEqual(moved?.queue.map((item) => item.id), ["b", "c", "a"]);
    assert.equal(moved?.index, 2);
    assert.equal(moved?.trackChanged, false);
    assert.equal(moveQueueItem(queue, 0, 1, 1), null);
  });
});
