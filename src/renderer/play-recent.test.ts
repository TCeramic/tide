import assert from "node:assert/strict";
import { it } from "node:test";
import type { PlaybackSnapshot, Track } from "../core/playback/types";
import { playRecentTrack } from "./play-recent";

const track = (id: string): Track => ({ id, title: id, artist: "Artist", durationMs: 60_000 });
function fixture(ids: string[], index: number) {
  let state: PlaybackSnapshot = { queue: ids.map(track), index, status: "paused", positionMs: 12000, volume: .8, error: null, repeat: "all", shuffle: false, explore: false };
  const bridge = {
    getPlayback: async () => state,
    hardwareKey: async () => { state = { ...state, status: "playing" }; return state; },
    queueMove: async (from: number, to: number) => {
      const current = state.queue[state.index]?.id;
      const queue = [...state.queue]; const [row] = queue.splice(from, 1); queue.splice(to, 0, row!);
      state = { ...state, queue, index: queue.findIndex(item => item.id === current) }; return state;
    },
    playNext: async (row: Track) => { const queue = [...state.queue]; queue.splice(state.index + 1, 0, row); state = { ...state, queue }; return state; },
    changeTrack: async (next: number) => { state = { ...state, index: next, positionMs: 0, status: "playing" }; return state; },
  };
  return { bridge, current: () => state };
}
it("recent replay inserts and starts after the current track without replacing the queue", async () => {
  const f = fixture(["a", "b", "c"], 1);
  await playRecentTrack(f.bridge, track("x"));
  assert.deepEqual(f.current().queue.map(row => row.id), ["a", "b", "x", "c"]);
  assert.equal(f.current().queue[f.current().index]?.id, "x");
});
it("recent replay moves an already queued track after the current one without duplicates", async () => {
  const f = fixture(["a", "b", "c", "d"], 2);
  await playRecentTrack(f.bridge, track("a"));
  assert.deepEqual(f.current().queue.map(row => row.id), ["b", "c", "a", "d"]);
  assert.equal(f.current().index, 2);
});
it("replaying the current track resumes it without restarting or moving the queue", async () => {
  const f = fixture(["a", "b"], 0);
  await playRecentTrack(f.bridge, track("a"));
  assert.equal(f.current().status, "playing"); assert.equal(f.current().positionMs, 12000);
  assert.deepEqual(f.current().queue.map(row => row.id), ["a", "b"]);
});
it("recent replay starts the first song in an empty queue", async () => {
  const f = fixture([], -1); await playRecentTrack(f.bridge, track("x"));
  assert.equal(f.current().index, 0); assert.equal(f.current().status, "playing");
});
