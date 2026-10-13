import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PlaybackMachine } from "./machine";
import type { Track } from "./types";

function track(id: string, durationMs = 1000): Track {
  return { id, title: id, artist: "潮汐", durationMs };
}

describe("PlaybackMachine", () => {
  it("starts idle", () => {
    const machine = new PlaybackMachine();
    assert.equal(machine.getState().status, "idle");
    assert.equal(machine.getState().index, -1);
    assert.equal(machine.getState().volume, 0.8);
  });

  it("play on an empty queue emits play and lands on error", () => {
    const machine = new PlaybackMachine();
    const events: string[] = [];
    machine.events.on("play", (payload) => events.push(payload.snapshot.status));
    const state = machine.play();
    assert.equal(state.status, "error");
    assert.equal(state.error, "empty_queue");
    assert.deepEqual(events, ["error"]);
  });

  it("passes through loading before playing", () => {
    const machine = new PlaybackMachine();
    machine.setQueue([track("a")]);
    const loading = machine.beginLoad();
    assert.equal(loading.status, "loading");
    const playing = machine.completeLoad();
    assert.equal(playing.status, "playing");
    assert.equal(playing.error, null);
  });

  it("play from a queued track reaches playing", () => {
    const machine = new PlaybackMachine();
    machine.setQueue([track("a")]);
    assert.equal(machine.getState().status, "paused");
    assert.equal(machine.play().status, "playing");
    assert.equal(machine.play().status, "playing");
  });

  it("pause emits only while playing", () => {
    const machine = new PlaybackMachine();
    machine.setQueue([track("a")]);
    let pauses = 0;
    const off = machine.events.on("pause", () => {
      pauses += 1;
    });
    machine.pause();
    assert.equal(pauses, 0);
    machine.play();
    machine.pause();
    assert.equal(pauses, 1);
    assert.equal(machine.getState().status, "paused");
    off();
    machine.play();
    machine.pause();
    assert.equal(pauses, 1);
  });

  it("clamps seek and volume and emits those events", () => {
    const machine = new PlaybackMachine();
    machine.setQueue([track("a", 5000)]);
    const seen: string[] = [];
    machine.events.on("seek", (payload) => seen.push(`seek:${payload.positionMs}`));
    machine.events.on("volume", (payload) => seen.push(`volume:${payload.volume}`));
    assert.equal(machine.seek(9000).positionMs, 5000);
    assert.equal(machine.seek(-20).positionMs, 0);
    assert.equal(machine.setVolume(2).volume, 1);
    assert.equal(machine.setVolume(-1).volume, 0);
    assert.deepEqual(seen, ["seek:5000", "seek:0", "volume:1", "volume:0"]);
  });

  it("setQueue emits queue and track-change", () => {
    const machine = new PlaybackMachine();
    const seen: string[] = [];
    machine.events.on("queue", () => seen.push("queue"));
    machine.events.on("track-change", (payload) => seen.push(`track:${payload.index}`));
    const state = machine.setQueue([track("a"), track("b")], 1);
    assert.equal(state.index, 1);
    assert.equal(state.status, "paused");
    assert.deepEqual(seen, ["queue", "track:1"]);
    machine.changeTrack(0);
    assert.equal(machine.getState().index, 0);
    assert.equal(machine.getState().positionMs, 0);
    assert.equal(machine.getState().queue[0]?.title, "a");
  });

  it("rejects a missing track index", () => {
    const machine = new PlaybackMachine();
    machine.setQueue([track("a")]);
    const state = machine.changeTrack(3);
    assert.equal(state.status, "error");
    assert.equal(state.error, "track_missing");
  });

  it("tick advances, then moves to the next track", () => {
    const machine = new PlaybackMachine();
    machine.setQueue([track("a", 1000), track("b", 1000)]);
    machine.play();
    assert.equal(machine.tick(400), false);
    assert.equal(machine.getState().positionMs, 400);
    assert.equal(machine.tick(700), true);
    assert.equal(machine.getState().index, 1);
    assert.equal(machine.getState().status, "playing");
    assert.equal(machine.getState().positionMs, 0);
  });

  it("tick pauses at the end of the last track when repeat is off", () => {
    const machine = new PlaybackMachine();
    machine.setRepeat("off");
    machine.setQueue([track("a", 1000)]);
    machine.play();
    assert.equal(machine.tick(1000), true);
    assert.equal(machine.getState().status, "paused");
    assert.equal(machine.getState().positionMs, 1000);
  });

  it("list repeat wraps, single repeat restarts, and the next slot can be inserted", () => {
    const machine = new PlaybackMachine();
    machine.setQueue([track("a", 1000), track("b", 1000)]);
    machine.changeTrack(1);
    machine.play();
    assert.equal(machine.tick(1000), true);
    assert.equal(machine.getState().index, 0);

    machine.setRepeat("one");
    machine.changeTrack(1);
    machine.play();
    assert.equal(machine.tick(1000), true);
    assert.equal(machine.getState().index, 1);
    assert.equal(machine.getState().positionMs, 0);

    machine.insertNext(track("c"));
    assert.equal(machine.getState().queue[2]?.id, "c");
    machine.appendTracks([track("c"), track("d")]);
    assert.deepEqual(machine.getState().queue.map((item) => item.id), ["a", "b", "c", "d"]);
  });

  it("clearing the queue returns to idle", () => {
    const machine = new PlaybackMachine();
    machine.setQueue([track("a")]);
    machine.play();
    const state = machine.setQueue([]);
    assert.equal(state.status, "idle");
    assert.equal(state.index, -1);
    assert.equal(machine.tick(100), false);
  });

  it("syncPosition follows a playing track and ignores other states", () => {
    const machine = new PlaybackMachine();
    machine.setQueue([track("a", 5000)]);
    assert.equal(machine.syncPosition(1000).positionMs, 0);
    machine.play();
    assert.equal(machine.syncPosition(1500).positionMs, 1500);
    assert.equal(machine.syncPosition(9000).positionMs, 5000);
    machine.pause();
    assert.equal(machine.syncPosition(10).positionMs, 5000);
  });

  it("does not leak queue mutations back into the machine", () => {
    const machine = new PlaybackMachine();
    const source = [track("a")];
    machine.setQueue(source);
    source[0]!.title = "changed";
    const state = machine.getState();
    state.queue[0]!.title = "also";
    assert.equal(machine.getState().queue[0]?.title, "a");
  });
});
