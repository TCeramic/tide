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
  syncSystemMediaKeys,
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
    assert.deepEqual(hardwareKeyPaths(unfocused, false), []);
    assert.deepEqual(hardwareKeyPaths(idle, false), ["app-command"]);
    assert.deepEqual(hardwareKeyPaths(playing, false), ["app-command", "session"]);
  });

  it("registers the four system media keys only while capture is on", () => {
    const held = new Set<string>();
    const sync = (capture: boolean) => {
      const result = syncSystemMediaKeys(capture, [...held], (accelerator) => {
        held.add(accelerator);
        return true;
      }, (accelerator) => {
        held.delete(accelerator);
      });
      return result.active;
    };
    assert.deepEqual(sync(true), ["MediaPlayPause", "MediaNextTrack", "MediaPreviousTrack", "MediaStop"]);
    assert.equal(held.size, 4);
    assert.deepEqual(sync(false), []);
    assert.equal(held.size, 0);
    assert.equal(sync(true).length, 4);
  });

  it("runs two next presses from the same source inside 300ms", () => {
    const gate = createMediaDeduper(300);
    assert.equal(gate.accept("next", "shortcut", 1_000), true);
    assert.equal(gate.accept("next", "shortcut", 1_050), true);
  });

  it("drops the same action from an interleaved source and keeps a different action", () => {
    const gate = createMediaDeduper(300);
    assert.equal(gate.accept("next", "shortcut", 2_000), true);
    assert.equal(gate.accept("previous", "app-command", 2_010), true);
    assert.equal(gate.accept("next", "app-command", 2_020), false);
    assert.equal(gate.accept("next", "session", 2_040), false);
    assert.equal(gate.accept("next", "shortcut", 2_080), true);
    assert.equal(gate.accept("previous", "shortcut", 2_090), false);
    assert.equal(gate.accept("previous", "app-command", 2_320), true);
  });

  it("collapses one press from shortcut, app-command, and mediaSession into one action", () => {
    const gate = createMediaDeduper(300);
    assert.equal(gate.accept("toggle", "shortcut", 1_000), true);
    assert.equal(gate.accept("pause", "session", 1_020), false);
    assert.equal(gate.accept("play", "app-command", 1_040), false);
    assert.equal(gate.accept("next", "shortcut", 1_050), true);
    assert.equal(gate.accept("nexttrack", "session", 1_060), false);
    assert.equal(gate.accept("stop", "shortcut", 1_070), true);
    assert.equal(gate.accept("previous", "app-command", 1_080), true);
    assert.equal(gate.accept("toggle", "shortcut", 1_300), true);

    const once = (events: { action: string; source: string }[], start: "playing" | "paused") => {
      const dedupe = createMediaDeduper(300);
      let status = start;
      events.forEach((event, index) => {
        if (!dedupe.accept(event.action, event.source, index)) return;
        if (event.action === "toggle") status = status === "playing" ? "paused" : "playing";
        else if (event.action === "pause") status = "paused";
        else if (event.action === "play") status = "playing";
      });
      return status;
    };
    assert.equal(once([{ action: "toggle", source: "shortcut" }, { action: "pause", source: "session" }], "playing"), "paused");
    assert.equal(once([{ action: "pause", source: "session" }, { action: "toggle", source: "shortcut" }], "playing"), "paused");
    assert.equal(once([{ action: "toggle", source: "shortcut" }, { action: "play", source: "session" }], "paused"), "playing");
    assert.equal(once([{ action: "play", source: "session" }, { action: "toggle", source: "shortcut" }], "paused"), "playing");
  });

  it("normalizes custom combos and reports clashes and a failed register", () => {
    assert.equal(normalizeAccelerator("ctrl+alt+right"), "Ctrl+Alt+Right");
    assert.equal(normalizeAccelerator("Ctrl+Shift+F13"), "Ctrl+Shift+F13");
    assert.equal(normalizeAccelerator("ctrl+shift+f24"), "Ctrl+Shift+F24");
    assert.equal(normalizeAccelerator("Ctrl+F25"), null);
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
    const empty = { toggle: "", next: "", previous: "", stop: "" };
    const taken = applyShortcutPlan(
      planCustomShortcuts({ toggle: "Ctrl+Alt+Right", next: "", previous: "", stop: "" }),
      empty,
      () => false,
    );
    assert.equal(taken.saved.toggle, "");
    assert.match(taken.messages[0] ?? "", /已被占用/);
    const calls: string[] = [];
    const rolled = applyShortcutPlan(
      planCustomShortcuts({ toggle: "Ctrl+Alt+Left", next: "", previous: "", stop: "" }),
      { ...empty, toggle: "Ctrl+Alt+Right" },
      (accelerator, action) => {
        calls.push(`${action}:${accelerator}`);
        return accelerator === "Ctrl+Alt+Right";
      },
    );
    assert.deepEqual(calls, ["toggle:Ctrl+Alt+Left", "toggle:Ctrl+Alt+Right"]);
    assert.equal(rolled.saved.toggle, "Ctrl+Alt+Right");
    assert.match(rolled.messages[0] ?? "", /已被占用/);
    const saved = applyShortcutPlan(
      planCustomShortcuts({ toggle: "", next: "Ctrl+Alt+Right", previous: "", stop: "" }),
      empty,
      () => true,
    );
    assert.equal(saved.saved.next, "Ctrl+Alt+Right");
    assert.deepEqual(saved.messages, []);
  });
});
