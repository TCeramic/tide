import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { CookieStore, hasMusicU, normalizeCookie } from "./cookie";

describe("cookie", () => {
  it("detects a non-empty MUSIC_U", () => {
    assert.equal(hasMusicU("NMTID=1; MUSIC_U=abc"), true);
    assert.equal(hasMusicU("MUSIC_U="), false);
    assert.equal(hasMusicU("other=MUSIC_U"), false);
  });

  it("rejects empty and oversized cookies", () => {
    assert.equal(normalizeCookie("  \n"), null);
    assert.equal(normalizeCookie("MUSIC_U=abc"), "MUSIC_U=abc");
    assert.equal(normalizeCookie(`MUSIC_U=${"a".repeat(9000)}`), null);
  });

  it("writes the cookie file with user-only permissions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tide-cookie-"));
    const file = path.join(dir, "netease.cookie");
    const store = new CookieStore(file);
    assert.equal(store.read(), null);
    store.write("MUSIC_U=secret");
    assert.equal(store.read(), "MUSIC_U=secret");
    // Node's POSIX mode bits do not represent Windows ACLs.
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    store.clear();
    assert.equal(fs.existsSync(file), false);
    assert.equal(store.read(), null);
  });
});
