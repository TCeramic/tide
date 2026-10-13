import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dispatchCommand, type CommandHost } from "./command-bus";
import { allowListFromUnknown, scrub } from "../shared/commands";

function host(overrides: Partial<CommandHost> = {}): CommandHost & { calls: string[] } {
  const calls: string[] = [];
  const mark = (name: string) => {
    calls.push(name);
    return { called: name };
  };
  return {
    calls,
    playbackGet: () => mark("playback.get"),
    playbackPlay: () => mark("playback.play"),
    playbackPause: () => mark("playback.pause"),
    playbackSeek: () => mark("playback.seek"),
    playbackVolume: () => mark("playback.volume"),
    playbackNext: () => mark("playback.next"),
    playbackPrev: () => mark("playback.prev"),
    playbackQueue: () => mark("playback.queue"),
    playbackPlayHits: () => mark("playback.playHits"),
    playbackMode: () => mark("playback.mode"),
    settingsRead: () => ({ volume: 0.8, cookie: "MUSIC_U=secret" }),
    settingsWrite: () => mark("settings.write"),
    appearanceRead: () => ({ chromeVisible: true, stageLevel: 1 }),
    appearanceWrite: () => mark("appearance.write"),
    librarySearch: () => mark("library.search"),
    libraryPlaylistTracks: () => mark("library.playlistTracks"),
    libraryDaily: () => mark("library.daily"),
    libraryRadar: () => mark("library.radar"),
    libraryTideToday: () => mark("library.tideToday"),
    librarySession: () => ({ ok: true, state: "signed_out", cookie: "MUSIC_U=secret" }),
    sessionLogout: () => mark("session.logout"),
    ...overrides,
  };
}

describe("command bus", () => {
  it("runs a playback command and scrubs secrets from reads", async () => {
    const api = host();
    const paused = await dispatchCommand({ command: "playback.pause" }, api, []);
    assert.equal(paused.ok, true);
    assert.deepEqual(api.calls, ["playback.pause"]);
    const session = await dispatchCommand({ command: "library.session" }, api, []);
    assert.equal(session.ok, true);
    assert.equal(JSON.stringify(session).includes("MUSIC_U"), false);
    assert.equal(JSON.stringify(session).includes("cookie"), false);
  });

  it("denies settings writes unless this request or the whitelist allows them", async () => {
    const blocked = host();
    const denied = await dispatchCommand({ command: "settings.write", args: { volume: 0.2 } }, blocked, []);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error, "denied");
    assert.deepEqual(blocked.calls, []);

    const allowed = host();
    const wrote = await dispatchCommand({ command: "settings.write", args: { volume: 0.2 }, allow: true }, allowed, []);
    assert.equal(wrote.ok, true);
    assert.deepEqual(allowed.calls, ["settings.write"]);

    const listed = host();
    const fromFile = await dispatchCommand({ command: "session.logout" }, listed, ["session.logout"]);
    assert.equal(fromFile.ok, true);
    assert.deepEqual(listed.calls, ["session.logout"]);
  });

  it("does not pretend a playlist edit succeeded", async () => {
    const api = host();
    const denied = await dispatchCommand({ command: "playlist.organize", args: { id: "1" } }, api, []);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error, "denied");
    const unsupported = await dispatchCommand({ command: "playlist.organize", allow: true }, api, []);
    assert.equal(unsupported.ok, false);
    if (!unsupported.ok) assert.equal(unsupported.error, "unsupported");
    assert.deepEqual(api.calls, []);
  });

  it("sets repeat, shuffle, and explore without an allow flag", async () => {
    const api = host();
    const set = await dispatchCommand(
      { command: "playback.mode", args: { repeat: "one", shuffle: false, explore: true } },
      api,
      [],
    );
    assert.equal(set.ok, true);
    assert.deepEqual(api.calls, ["playback.mode"]);
    const missing = await dispatchCommand({ command: "playback.mode", args: {} }, api, []);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error, "bad_args");
    assert.deepEqual(api.calls, ["playback.mode"]);
  });

  it("writes a theme and motion only when that request is allowed", async () => {
    let patch: unknown = null;
    const api = host({
      appearanceWrite: (value) => {
        patch = value;
        api.calls.push("appearance.write");
        return value;
      },
    });
    const denied = await dispatchCommand({
      command: "appearance.write",
      args: { theme: "dusk", motion: 0 },
    }, api, []);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error, "denied");
    assert.equal(patch, null);

    const wrote = await dispatchCommand({
      command: "appearance.write",
      args: { theme: "dusk", motion: 0 },
      allow: true,
    }, api, []);
    assert.equal(wrote.ok, true);
    assert.deepEqual(patch, { theme: "dusk", motion: 0 });

    const unknown = await dispatchCommand({
      command: "appearance.write",
      args: { theme: "wallpaper" },
      allow: true,
    }, api, []);
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.error, "bad_args");
  });

  it("rejects unknown commands and keeps cookies out of the allow file", () => {
    assert.deepEqual(allowListFromUnknown({
      allow: ["settings.write", "playback.pause", "cookie"],
      cookie: "MUSIC_U=secret",
    }), ["settings.write"]);
    const cleaned = scrub({ cookie: "MUSIC_U=secret", title: "青花瓷" }) as { title: string };
    assert.equal(cleaned.title, "青花瓷");
    assert.equal("cookie" in cleaned, false);
  });
});
