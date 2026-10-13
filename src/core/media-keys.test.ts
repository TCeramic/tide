import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEDIA_SESSION_ACTIONS, MEDIA_SHORTCUTS, shortcutAction } from "./media-keys";

describe("media keys", () => {
  it("maps the three global media keys and the mediaSession actions", () => {
    assert.deepEqual(MEDIA_SHORTCUTS.map((name) => shortcutAction(name)), ["toggle", "next", "previous"]);
    assert.equal(shortcutAction("VolumeUp"), null);
    assert.deepEqual(MEDIA_SESSION_ACTIONS, ["play", "pause", "nexttrack", "previoustrack"]);
  });
});