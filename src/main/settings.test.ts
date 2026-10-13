import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { SettingsStore, settingsFromUnknown } from "./settings";

describe("settings", () => {
  it("keeps only a clamped volume", () => {
    assert.deepEqual(settingsFromUnknown({ volume: 2, cookie: "MUSIC_U=secret" }), { volume: 1 });
    assert.deepEqual(settingsFromUnknown({ volume: -1 }), { volume: 0 });
    assert.deepEqual(settingsFromUnknown({ volume: "0.2" }), { volume: 0.8 });
    assert.deepEqual(settingsFromUnknown(null), { volume: 0.8 });
  });

  it("restores volume from disk and drops anything else", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tide-settings-"));
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, JSON.stringify({ volume: 0.35, cookie: "MUSIC_U=secret" }));
    const store = new SettingsStore(file);
    assert.equal(store.read().volume, 0.35);
    store.write(0.2);
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    assert.deepEqual(saved, { volume: 0.2 });
    fs.writeFileSync(file, "{");
    assert.equal(store.read().volume, 0.8);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});