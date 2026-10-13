import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { NeteaseClient } from "./netease";
import { createTideApiServer } from "./server";

const validCookie = "MUSIC_U=tide-test; __csrf=1";

function fakeNetease(): NeteaseClient & { checks: number } {
  return {
    checks: 0,
    async qrKey() {
      return "unikey-12345678";
    },
    async qrImage(key) {
      return {
        qrurl: `https://music.163.com/login?codekey=${key}`,
        qrimg: "data:image/png;base64,aaa",
      };
    },
    async qrCheck() {
      this.checks += 1;
      if (this.checks === 1) return { code: 801, cookie: "NMTID=waiting" };
      return { code: 803, cookie: validCookie };
    },
    async loginStatus(cookie) {
      if (cookie.includes("MUSIC_U=bad")) return null;
      if (cookie.includes("MUSIC_U=tide-test")) return { id: "7", nickname: "潮友" };
      return null;
    },
    async playlists() {
      return [{ id: "9", name: "我喜欢的音乐", trackCount: 3 }];
    },
  };
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("expected a tcp port"));
        return;
      }
      resolve(address.port);
    });
  });
}

interface Payload {
  ok?: boolean;
  state?: string;
  error?: string;
  message?: string | null;
  code?: number;
  key?: string;
  user?: { nickname?: string } | null;
  playlists?: { name?: string }[];
  session?: { state?: string } | null;
}

async function call(port: number, method: string, pathname: string, body?: unknown): Promise<{ status: number; json: Payload }> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Payload };
}

describe("session routes", { concurrency: 1 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tide-session-"));
  const cookieFile = path.join(dir, "netease.cookie");
  const netease = fakeNetease();
  const server = createTideApiServer({ cookieFile, netease });
  let port = 0;

  before(async () => {
    port = await listen(server);
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("starts signed out", async () => {
    const { json } = await call(port, "GET", "/session");
    assert.equal(json.state, "signed_out");
    assert.deepEqual(json.playlists, []);
  });

  it("rejects a cookie without MUSIC_U and does not save it", async () => {
    const { status, json } = await call(port, "POST", "/session/cookie", { cookie: "NMTID=1" });
    assert.equal(status, 400);
    assert.equal(json.error, "missing_music_u");
    assert.equal(fs.existsSync(cookieFile), false);
  });

  it("does not save a cookie that fails the login check", async () => {
    const { json } = await call(port, "POST", "/session/cookie", { cookie: "MUSIC_U=bad" });
    assert.equal(json.state, "invalid");
    assert.equal(fs.existsSync(cookieFile), false);
  });

  it("saves a valid cookie and lists playlists", async () => {
    const { json } = await call(port, "POST", "/session/cookie", { cookie: validCookie });
    assert.equal(json.state, "logged_in");
    assert.equal(json.user?.nickname, "潮友");
    assert.equal(json.playlists?.[0]?.name, "我喜欢的音乐");
    assert.equal(fs.readFileSync(cookieFile, "utf8"), validCookie);
    const again = await call(port, "GET", "/session");
    assert.equal(again.json.state, "logged_in");
  });

  it("clears the saved cookie", async () => {
    const { json } = await call(port, "POST", "/session/logout");
    assert.equal(json.state, "signed_out");
    assert.equal(fs.existsSync(cookieFile), false);
  });

  it("waits for a QR confirmation before writing the cookie", async () => {
    const started = await call(port, "POST", "/session/qr/start");
    assert.equal(started.status, 200);
    assert.equal(started.json.ok, true);
    const waiting = await call(port, "GET", `/session/qr/check?key=${started.json.key ?? ""}`);
    assert.equal(waiting.json.code, 801);
    assert.equal(fs.existsSync(cookieFile), false);
    const done = await call(port, "GET", `/session/qr/check?key=${started.json.key ?? ""}`);
    assert.equal(done.json.code, 803);
    assert.equal(done.json.session?.state, "logged_in");
    assert.equal(fs.readFileSync(cookieFile, "utf8"), validCookie);
  });

  it("marks a saved cookie invalid when login status is gone", async () => {
    fs.writeFileSync(cookieFile, "MUSIC_U=bad", { mode: 0o600 });
    const { json } = await call(port, "GET", "/session");
    assert.equal(json.state, "invalid");
    assert.match(json.message ?? "", /重新登录/);
    assert.equal(fs.existsSync(cookieFile), true);
  });
});
