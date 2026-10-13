import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MEDIA_SESSION_ACTIONS,
  MEDIA_SHORTCUTS,
  applyShortcutPlan,
  appCommandFromLParam,
  appCommandName,
  createMediaDeduper,
  hardwareKeyPaths,
  mediaSessionReceivesHardwareKey,
  normalizeAccelerator,
  planCustomShortcuts,
  shortcutAction,
} from "./media-keys";

describe("media keys", () => {
  it("maps media virtual keys, WM_APPCOMMAND, and mediaSession actions", () => {
    assert.deepEqual(MEDIA_SHORTCUTS.map((name) => shortcutAction(name)), ["toggle", "next", "previous", "stop"]);
    assert.equal(shortcutAction("VolumeUp"), null);
    assert.equal(appCommandName("media-nexttrack"), "next");
    assert.equal(appCommandName("media-previoustrack"), "previous");
    assert.equal(appCommandName("media-play-pause"), "toggle");
    assert.equal(appCommandName("media-stop"), "stop");
    assert.equal(appCommandName("browser-stop"), null);
    assert.equal(appCommandFromLParam(14 << 16), "toggle");
    assert.equal(appCommandFromLParam(11 << 16), "next");
    assert.equal(appCommandFromLParam(12 << 16), "previous");
    assert.equal(appCommandFromLParam(13 << 16), "stop");
    assert.equal(appCommandFromLParam((14 << 16) | (1 << 28)), "toggle");
    assert.equal(appCommandFromLParam(0), null);
    assert.deepEqual(MEDIA_SESSION_ACTIONS, ["play", "pause", "nexttrack", "previoustrack", "stop"]);
  });

  it("keeps a hardware path when mediaSession cannot hear the key", () => {
    const unfocused = { focused: false, minimized: false, playbackStarted: true };
    const minimized = { focused: true, minimized: true, playbackStarted: true };
    const idle = { focused: true, minimized: false, playbackStarted: false };
    const playing = { focused: true, minimized: false, playbackStarted: true };
    assert.equal(mediaSessionReceivesHardwareKey(unfocused), false);
    assert.equal(mediaSessionReceivesHardwareKey(minimized), false);
    assert.equal(mediaSessionReceivesHardwareKey(idle), false);
    assert.equal(mediaSessionReceivesHardwareKey(playing), true);
    for (const state of [unfocused, minimized, idle, playing]) {
      assert.equal(hardwareKeyPaths(state)[0], "shortcut");
    }
    assert.deepEqual(hardwareKeyPaths(idle), ["shortcut", "app-command"]);
    assert.deepEqual(hardwareKeyPaths(unfocused), ["shortcut"]);
    assert.deepEqual(hardwareKeyPaths(playing), ["shortcut", "app-command", "session"]);
  });

  it("collapses one press from shortcut, app-command, and mediaSession into one action", () => {
    const gate = createMediaDeduper(300);
    assert.equal(gate.accept("toggle", 1_000), true);
    assert.equal(gate.accept("pause", 1_020), false);
    assert.equal(gate.accept("play", 1_040), false);
    assert.equal(gate.accept("next", 1_050), true);
    assert.equal(gate.accept("nexttrack", 1_060), false);
    assert.equal(gate.accept("stop", 1_070), true);
    assert.equal(gate.accept("previous", 1_080), true);
    assert.equal(gate.accept("toggle", 1_300), true);

    const once = (actions: string[], start: "playing" | "paused") => {
      const dedupe = createMediaDeduper(300);
      let status = start;
      actions.forEach((action, index) => {
        if (!dedupe.accept(action, index)) return;
        if (action === "toggle") status = status === "playing" ? "paused" : "playing";
        else if (action === "pause") status = "paused";
        else if (action === "play") status = "playing";
      });
      return status;
    };
    assert.equal(once(["toggle", "pause"], "playing"), "paused");
    assert.equal(once(["pause", "toggle"], "playing"), "paused");
    assert.equal(once(["toggle", "play"], "paused"), "playing");
    assert.equal(once(["play", "toggle"], "paused"), "playing");
  });

  it("normalizes custom combos and reports clashes and a failed register", () => {
    assert.equal(normalizeAccelerator("ctrl+alt+right"), "Ctrl+Alt+Right");
    assert.equal(normalizeAccelerator("Right"), null);
    assert.equal(normalizeAccelerator("MediaPlayPause"), null);
    const plan = planCustomShortcuts({
      toggle: "Ctrl+Alt+Space",
      next: "ctrl+alt+right",
      previous: "Ctrl+Alt+Right",
      stop: "MediaStop",
    });
    assert.deepEqual(plan.register.map((item) => item.accelerator), ["Ctrl+Alt+Space", "Ctrl+Alt+Right"]);
    assert.match(plan.messages.join(" "), /已经用于下一首/);
    assert.match(plan.messages.join(" "), /系统媒体键已经可用/);
    const taken = applyShortcutPlan(
      planCustomShortcuts({ toggle: "Ctrl+Alt+Right", next: "", previous: "", stop: "" }),
      () => false,
    );
    assert.equal(taken.saved.toggle, "");
    assert.match(taken.messages[0] ?? "", /已被占用/);
    const saved = applyShortcutPlan(
      planCustomShortcuts({ toggle: "", next: "Ctrl+Alt+Right", previous: "", stop: "" }),
      () => true,
    );
    assert.equal(saved.saved.next, "Ctrl+Alt+Right");
    assert.deepEqual(saved.messages, []);
  });
});
