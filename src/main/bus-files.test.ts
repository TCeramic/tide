import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { BusAllowStore, BusTokenStore } from "./bus-files";

describe("command bus files", () => {
  it("stores a token without turning the allow file into a cookie jar", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tide-bus-"));
    const token = new BusTokenStore(path.join(dir, "bus-token"));
    const first = token.read();
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(token.read(), first);
    assert.equal(fs.statSync(path.join(dir, "bus-token")).mode & 0o777, 0o600);

    const allowFile = path.join(dir, "bus-allow.json");
    fs.writeFileSync(allowFile, JSON.stringify({
      allow: ["appearance.write", "not-a-command", "playback.pause"],
      cookie: "MUSIC_U=secret",
    }));
    assert.deepEqual(new BusAllowStore(allowFile).read(), ["appearance.write"]);
    assert.deepEqual(new BusAllowStore(path.join(dir, "missing.json")).read(), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
