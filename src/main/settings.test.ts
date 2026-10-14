import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_DESK_LYRICS } from "../core/desk-lyrics";
import { EMPTY_MEDIA_SHORTCUTS } from "../core/media-keys";
import { SettingsStore, settingsFromUnknown } from "./settings";

describe("settings", () => {
  it("keeps only a clamped volume and the local ui knobs", () => {
    assert.deepEqual(settingsFromUnknown({ volume: 2, cookie: "MUSIC_U=secret", theme: "wallpaper" }), {
      volume: 1,
      chromeVisible: true,
      stageLevel: 1,
      theme: "tide",
      motion: 1,
      quality: "standard",
      mediaShortcuts: { ...EMPTY_MEDIA_SHORTCUTS },
      captureMediaKeys: true,
      deskLyrics: { ...DEFAULT_DESK_LYRICS },
    });
    assert.deepEqual(settingsFromUnknown({ volume: -1, stageLevel: 2, chromeVisible: false, theme: "dusk", motion: 2, quality: "hires" }), {
      volume: 0,
      chromeVisible: false,
      stageLevel: 1,
      theme: "dusk",
      motion: 1,
      quality: "hires",
      mediaShortcuts: { ...EMPTY_MEDIA_SHORTCUTS },
      captureMediaKeys: true,
      deskLyrics: { ...DEFAULT_DESK_LYRICS },
    });
    assert.deepEqual(settingsFromUnknown({ volume: "0.2", motion: 0, quality: "surround" }), {
      volume: 0.8,
      chromeVisible: true,
      stageLevel: 1,
      theme: "tide",
      motion: 0,
      quality: "standard",
      mediaShortcuts: { ...EMPTY_MEDIA_SHORTCUTS },
      captureMediaKeys: true,
      deskLyrics: { ...DEFAULT_DESK_LYRICS },
    });
    assert.equal("cookie" in settingsFromUnknown({ volume: 0.5, cookie: "MUSIC_U=secret" }), false);
    assert.equal(settingsFromUnknown({}).captureMediaKeys, true);
    assert.equal(settingsFromUnknown({ captureMediaKeys: false }).captureMediaKeys, false);
  });

  it("restores volume from disk and drops anything else", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tide-settings-"));
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, JSON.stringify({ volume: 0.35, cookie: "MUSIC_U=secret" }));
    const store = new SettingsStore(file);
    assert.equal(store.read().volume, 0.35);
    store.write({ volume: 0.2 });
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    assert.deepEqual(saved, {
      volume: 0.2,
      chromeVisible: true,
      stageLevel: 1,
      theme: "tide",
      motion: 1,
      quality: "standard",
      mediaShortcuts: { ...EMPTY_MEDIA_SHORTCUTS },
      captureMediaKeys: true,
      deskLyrics: { ...DEFAULT_DESK_LYRICS },
    });
    store.write({ captureMediaKeys: false });
    assert.equal(store.read().captureMediaKeys, false);
    store.write({ theme: "dusk", motion: 0 });
    const themed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    assert.equal(themed.theme, "dusk");
    assert.equal(themed.motion, 0);
    assert.equal(themed.volume, 0.2);
    assert.equal("cookie" in saved, false);
    fs.writeFileSync(file, "{");
    assert.equal(store.read().volume, 0.8);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});