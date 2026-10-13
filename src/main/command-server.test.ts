import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startCommandServer, type RunningCommandServer } from "./command-server";
import type { CommandHost } from "../core/command-bus";

const TOKEN = "ab".repeat(32);

function host(): CommandHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    playbackGet: () => ({ status: "idle" }),
    playbackPlay: () => ({ status: "idle" }),
    playbackPause: () => {
      calls.push("pause");
      return { status: "paused" };
    },
    playbackSeek: () => ({ status: "paused" }),
    playbackVolume: () => ({ status: "paused", volume: 0.4 }),
    playbackNext: () => ({ status: "paused" }),
    playbackPrev: () => ({ status: "paused" }),
    playbackQueue: () => ({ status: "paused" }),
    playbackPlayHits: () => ({ status: "paused" }),
    playbackMode: () => ({ status: "paused", repeat: "all", explore: false }),
    settingsRead: () => ({ volume: 0.8, chromeVisible: true, stageLevel: 1 }),
    settingsWrite: () => {
      calls.push("settings.write");
      return { volume: 0.2 };
    },
    appearanceRead: () => ({ chromeVisible: true, stageLevel: 1 }),
    appearanceWrite: () => ({ chromeVisible: false, stageLevel: 0 }),
    librarySearch: () => ({ ok: true, hits: [] }),
    libraryPlaylistTracks: () => ({ ok: true, hits: [] }),
    libraryDaily: () => ({ ok: true, hits: [] }),
    libraryRadar: () => ({ ok: true, hits: [] }),
    libraryTideToday: () => ({ ok: true, hits: [], message: null }),
    librarySession: () => ({ ok: true, state: "signed_out", playlists: [], cookie: "MUSIC_U=secret" }),
    sessionLogout: () => {
      calls.push("logout");
      return { ok: true, state: "signed_out" };
    },
  };
}

describe("command server", { concurrency: 1 }, () => {
  const api = host();
  let running: RunningCommandServer | null = null;

  before(async () => {
    running = await startCommandServer({
      token: TOKEN,
      host: api,
      readAllow: () => [],
      port: 0,
    });
  });

  after(async () => {
    await running?.close();
  });

  it("serves health, playback, a denied write, and a scrubbed read on loopback", async () => {
    const server = running;
    assert.ok(server);
    assert.equal(server.port > 0, true);

    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    const healthBody = (await health.json()) as { ok: boolean; service: string; version: string };
    assert.equal(health.status, 200);
    assert.equal(healthBody.service, "tide-bus");
    assert.equal(healthBody.version, "0.8.0");

    const naked = await fetch(`http://127.0.0.1:${server.port}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "playback.pause" }),
    });
    assert.equal(naked.status, 401);

    const paused = await fetch(`http://127.0.0.1:${server.port}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ command: "playback.pause" }),
    });
    const pausedBody = (await paused.json()) as { ok: boolean; result: { status: string } };
    assert.equal(paused.status, 200);
    assert.equal(pausedBody.ok, true);
    assert.equal(pausedBody.result.status, "paused");

    const denied = await fetch(`http://127.0.0.1:${server.port}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ command: "settings.write", args: { volume: 0.1 } }),
    });
    const deniedBody = (await denied.json()) as { ok: boolean; error: string };
    assert.equal(denied.status, 403);
    assert.equal(deniedBody.error, "denied");
    assert.equal(api.calls.includes("settings.write"), false);

    const session = await fetch(`http://127.0.0.1:${server.port}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ command: "library.session" }),
    });
    const sessionText = await session.text();
    assert.equal(session.status, 200);
    assert.equal(sessionText.includes("MUSIC_U"), false);
    assert.equal(sessionText.includes("cookie"), false);
    assert.equal(sessionText.includes("signed_out"), true);

    const organize = await fetch(`http://127.0.0.1:${server.port}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ command: "playlist.organize", allow: true }),
    });
    const organizeBody = (await organize.json()) as { error: string };
    assert.equal(organize.status, 501);
    assert.equal(organizeBody.error, "unsupported");
  });

  it("pushes playback events on the loopback socket without a cookie", async () => {
    assert.ok(running);
    const server = running;
    const messages: string[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/events?token=${TOKEN}`);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("message", (event) => {
        messages.push(String(event.data));
        if (messages.some((item) => item.includes("paused"))) resolve();
      });
      socket.addEventListener("error", () => reject(new Error("socket failed")));
      socket.addEventListener("open", () => {
        server.publish({ type: "playback", snapshot: { status: "paused", cookie: "MUSIC_U=secret" } });
      });
    });
    socket.close();
    const joined = messages.join("\n");
    assert.equal(joined.includes("MUSIC_U"), false);
    assert.equal(joined.includes("cookie"), false);
    assert.equal(joined.includes("tide-bus"), true);
  });
});
