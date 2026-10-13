import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ListenLog } from "./listen-log";

describe("listen log", () => {
  it("stores plays and skips and drops secrets", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tide-log-"));
    const file = path.join(dir, "listen-log.json");
    fs.writeFileSync(file, JSON.stringify({
      events: [{
        id: "1",
        title: "青花瓷",
        artist: "周杰伦",
        durationMs: 1000,
        at: 1,
        kind: "play",
        cookie: "MUSIC_U=secret",
      }],
    }));
    const log = new ListenLog(file);
    const read = log.read();
    assert.equal(read.length, 1);
    assert.equal("cookie" in read[0]!, false);
    assert.equal(JSON.stringify(read).includes("MUSIC_U"), false);
    log.append("skip", { id: "1", title: "青花瓷", artist: "周杰伦", durationMs: 1000 });
    log.append("play", { id: "not-a-song", title: "x", artist: "y", durationMs: 1 });
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { events: Record<string, unknown>[] };
    assert.equal(saved.events.length, 2);
    assert.equal(saved.events[1]?.kind, "skip");
    assert.equal(saved.events.some((event) => "cookie" in event), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
