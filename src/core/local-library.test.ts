import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLocalId, localIdFor, searchLocalTracks, titleFromFile, type LocalTrack } from "./local-library";

describe("local library", () => {
  it("searches offline tracks and keeps a stable id", () => {
    const file = "/music/周杰伦 - 青花瓷.mp3";
    const id = localIdFor(file);
    assert.equal(isLocalId(id), true);
    assert.equal(localIdFor(file), id);
    const named = titleFromFile(file);
    assert.equal(named.artist, "周杰伦");
    assert.equal(named.title, "青花瓷");
    const tracks: LocalTrack[] = [{ id, title: named.title, artist: named.artist, durationMs: 0, file }];
    assert.equal(searchLocalTracks(tracks, "青花").length, 1);
    assert.equal(searchLocalTracks(tracks, "不存在").length, 0);
    assert.equal(searchLocalTracks(tracks, "  ").length, 0);
  });
});