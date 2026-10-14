import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as lucide from "lucide";
import { latticeEnabled, latticeTargets, stepLattice, writeLatticeFlag } from "./lattice-field";
import { ICON_SIZE, ICON_STROKE, SHELL_ICONS } from "./icons";
import { settleSpring, stepSpring } from "./spring";

describe("lucide shell icons", () => {
  it("uses one stroke and the shared Lucide set", () => {
    assert.equal(ICON_STROKE, 1.75);
    assert.deepEqual(ICON_SIZE, { row: 16, control: 18, play: 22 });
    const table = lucide as unknown as Record<string, unknown>;
    for (const name of SHELL_ICONS) {
      assert.equal(Array.isArray(table[name]), true, name);
    }
  });
});

describe("lens spring", () => {
  it("settles on the target", () => {
    const done = settleSpring({ value: 0, velocity: 0 }, 1);
    assert.ok(Math.abs(done.value - 1) < 0.02);
    assert.ok(Math.abs(done.velocity) < 0.05);
  });

  it("keeps going from the current pose when the target changes", () => {
    const mid = stepSpring({ value: 0, velocity: 0 }, 1, 1 / 60);
    assert.ok(mid.value > 0 && mid.value < 1);
    const turned = stepSpring(mid, 0, 1 / 60);
    assert.ok(turned.value < mid.value + 0.05);
    const home = settleSpring(turned, 0);
    assert.ok(Math.abs(home.value) < 0.02);
  });
});

describe("lattice layer", () => {
  it("stays off until asked, and keeps points inside the frame", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    assert.equal(latticeEnabled(storage), false);
    assert.equal(latticeEnabled(null), false);
    writeLatticeFlag(storage, true);
    assert.equal(latticeEnabled(storage), true);

    const idle = latticeTargets(64, 0.25, 0);
    const playing = latticeTargets(64, 0.8, 1);
    assert.equal(idle.length, 64);
    assert.equal(playing.length, 64);
    for (const point of [...idle, ...playing]) {
      assert.ok(point.x >= 0 && point.x <= 1);
      assert.ok(point.y >= 0 && point.y <= 1);
      assert.ok(point.r > 0);
    }
    const sprung = stepLattice([], playing, 1 / 60);
    assert.equal(sprung.length, playing.length);
    assert.ok(sprung[0] && sprung[0].x.value > 0 && sprung[0].x.value < 1);
  });
});
