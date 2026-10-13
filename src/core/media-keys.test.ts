import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEDIA_SESSION_ACTIONS, MEDIA_SHORTCUTS, dispatchMediaKey, shortcutAction } from "./media-keys";

describe("media keys", () => {
  it("maps the three global media keys and the mediaSession actions", () => {
    assert.deepEqual(MEDIA_SHORTCUTS.map((name) => shortcutAction(name)), ["toggle", "next", "previous"]);
    assert.equal(shortcutAction("VolumeUp"), null);
    assert.deepEqual(MEDIA_SESSION_ACTIONS, ["play", "pause", "nexttrack", "previoustrack"]);
  });

  it("fires play/pause once, through mediaSession on Windows and the shortcut elsewhere", () => {
    const run = (platform: string) => {
      const calls: string[] = [];
      dispatchMediaKey(platform, "toggle", {
        shortcut: () => calls.push("shortcut"),
        session: () => calls.push("session"),
      });
      return calls;
    };
    assert.deepEqual(run("win32"), ["session"]);
    assert.deepEqual(run("linux"), ["shortcut"]);
    assert.deepEqual(run("darwin"), ["shortcut"]);
  });
});