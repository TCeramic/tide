import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_DESK_LYRICS } from "../core/desk-lyrics";
import { DEFAULT_MEDIA_SHORTCUTS } from "../core/media-keys";
import { SettingsStore, settingsFromUnknown } from "./settings";

describe("settings", () => {
  it("persists only a supported Liquid Metal emblem override",()=>{assert.equal(settingsFromUnknown({emblem:"liquid-metal"}).emblem,"liquid-metal");assert.equal(settingsFromUnknown({emblem:"auto"}).emblem,undefined);assert.equal(settingsFromUnknown({emblem:"unsupported"}).emblem,undefined);});
  it("persists independent modes and migrates old scenes", () => {
    assert.equal(settingsFromUnknown({theme:"dusk"}).lensMode,"dark");
    const value = settingsFromUnknown({lensMode:"dark",latticeMode:"light"});
    assert.equal(value.lensMode,"dark"); assert.equal(value.latticeMode,"light");
    assert.equal(settingsFromUnknown({lensMode:"invalid"}).lensMode,"light");
  });
  it("keeps only a clamped volume and the local ui knobs", () => {
    assert.deepEqual(settingsFromUnknown({ volume: 2, cookie: "MUSIC_U=secret", theme: "wallpaper" }), {
      lensMode: "light", latticeMode: "dark",
      volume: 1,
      chromeVisible: true,
      stageLevel: 1,
      theme: "tide",
      motion: 1,
      lattice: false,
      shell: "lens",
      preset: "flow",
      performance: "balanced",
      background: "paper",
      fontPreset: "system",
      fontFamily: "",
      quality: "standard",
      mediaShortcuts: { ...DEFAULT_MEDIA_SHORTCUTS },
      captureMediaKeys: true,
      deskLyrics: { ...DEFAULT_DESK_LYRICS },
      fontFile: "",
    });
    assert.deepEqual(settingsFromUnknown({ volume: -1, stageLevel: 2, chromeVisible: false, theme: "dusk", motion: 2, quality: "hires" }), {
      lensMode: "dark", latticeMode: "dark",
      volume: 0,
      chromeVisible: false,
      stageLevel: 1,
      theme: "dusk",
      motion: 1,
      lattice: false,
      shell: "lens",
      preset: "flow",
      performance: "balanced",
      background: "paper",
      fontPreset: "system",
      fontFamily: "",
      quality: "hires",
      mediaShortcuts: { ...DEFAULT_MEDIA_SHORTCUTS },
      captureMediaKeys: true,
      deskLyrics: { ...DEFAULT_DESK_LYRICS },
      fontFile: "",
    });
    assert.deepEqual(settingsFromUnknown({ volume: "0.2", motion: 0, quality: "surround" }), {
      lensMode: "light", latticeMode: "dark",
      volume: 0.8,
      chromeVisible: true,
      stageLevel: 1,
      theme: "tide",
      motion: 0,
      lattice: false,
      shell: "lens",
      preset: "flow",
      performance: "balanced",
      background: "paper",
      fontPreset: "system",
      fontFamily: "",
      quality: "standard",
      mediaShortcuts: { ...DEFAULT_MEDIA_SHORTCUTS },
      captureMediaKeys: true,
      deskLyrics: { ...DEFAULT_DESK_LYRICS },
      fontFile: "",
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
      lensMode: "light", latticeMode: "dark",
      volume: 0.2,
      chromeVisible: true,
      stageLevel: 1,
      theme: "tide",
      motion: 1,
      lattice: false,
      shell: "lens",
      preset: "flow",
      performance: "balanced",
      background: "paper",
      fontPreset: "system",
      fontFamily: "",
      quality: "standard",
      mediaShortcuts: { ...DEFAULT_MEDIA_SHORTCUTS },
      captureMediaKeys: true,
      deskLyrics: { ...DEFAULT_DESK_LYRICS },
      fontFile: "",
    });
    store.write({ captureMediaKeys: false });
    assert.equal(store.read().captureMediaKeys, false);
    store.write({ theme: "dusk", motion: 0 });
    const themed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    assert.equal(themed.theme, "dusk");
    assert.equal(themed.motion, 0);
    assert.equal(themed.volume, 0.2);
    assert.equal(themed.lattice, false);
    store.write({ lattice: true });
    assert.equal(store.read().lattice, true);
    assert.equal(settingsFromUnknown({ volume: 0.2 }).lattice, false);
    assert.equal("cookie" in saved, false);
    fs.writeFileSync(file, "{");
    assert.equal(store.read(true).volume, 0.8);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

it("settings reads share a short cache, stay isolated from callers, and support explicit reload",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"tide-settings-cache-")),file=path.join(dir,"settings.json");
 try{fs.writeFileSync(file,JSON.stringify({volume:.3}));const store=new SettingsStore(file),first=store.read();first.volume=.9;assert.equal(store.read().volume,.3);fs.writeFileSync(file,JSON.stringify({volume:.6}));assert.equal(store.read().volume,.3);assert.equal(store.read(true).volume,.6);store.write({volume:.7});assert.equal(store.read().volume,.7);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
