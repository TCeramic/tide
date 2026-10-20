import assert from "node:assert/strict";
import { it } from "node:test";
import type { PlaybackSnapshot, Track } from "../core/playback/types";
import { SessionHistory } from "./session-history";

const track = (id: string): Track => ({ id, title: `Song ${id}`, artist: "Artist", durationMs: 100_000 });
const snapshot = (status: PlaybackSnapshot["status"], id: string | null): PlaybackSnapshot => ({
  status,
  queue: id ? [track(id)] : [],
  index: id ? 0 : -1,
  positionMs: 0,
  volume: 0.8,
  error: null,
  repeat: "all",
  shuffle: false,
  explore: false,
});

it("records only tracks entering playback, de-duplicates pauses and moves a replay to the front", () => {
  const history = new SessionHistory(3);
  assert.equal(history.observe(snapshot("paused", "a"), 1), false);
  assert.equal(history.observe(snapshot("playing", "a"), 2), true);
  assert.equal(history.observe(snapshot("paused", "a"), 3), false);
  assert.equal(history.observe(snapshot("playing", "a"), 4), false);
  assert.equal(history.observe(snapshot("playing", "b"), 5), true);
  assert.equal(history.observe(snapshot("playing", "a"), 6), true);
  assert.deepEqual(history.items().map((row) => [row.id, row.playedAt]), [["a", 6], ["b", 5]]);
});

it("keeps a bounded in-memory list of unique tracks", () => {
  const history = new SessionHistory(2);
  history.observe(snapshot("playing", "a"), 1);
  history.observe(snapshot("playing", "b"), 2);
  history.observe(snapshot("playing", "c"), 3);
  assert.deepEqual(history.items().map((row) => row.id), ["c", "b"]);
});

it("restores recent tracks across launches and keeps metadata only", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const first = new SessionHistory(2, storage);
  const playing = snapshot("playing", "a");
  Object.assign(playing.queue[0]!, { url: "secret-media-url", cookie: "not-persisted" });
  first.observe(playing, 1);
  first.observe(snapshot("playing", "b"), 2);
  const restored = new SessionHistory(2, storage);
  assert.deepEqual(restored.items().map(row => row.id), ["b", "a"]);
  assert.equal([...values.values()][0]!.includes("secret"), false);
  restored.observe(snapshot("playing", "a"), 3);
  assert.deepEqual(new SessionHistory(2, storage).items().map(row => [row.id, row.playedAt]), [["a", 3], ["b", 2]]);
});

it("ignores invalid storage records and continues when writes fail", () => {
  const storage = { getItem: () => JSON.stringify([null, { ...track("a"), playedAt: 2 }, { ...track("a"), playedAt: 1 }, { ...track("b"), playedAt: "invalid" }]), setItem: () => { throw new Error("quota"); } };
  const history = new SessionHistory(100, storage);
  assert.deepEqual(history.items().map(row => row.id), ["a"]);
  assert.equal(history.observe(snapshot("playing", "c"), 3), true);
  const corrupt = new SessionHistory(100, { getItem: () => "broken-json", setItem: () => undefined });
  assert.deepEqual(corrupt.items(), []);
});
