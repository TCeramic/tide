import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { budgetsDiffer, performanceBudget } from "./performance";

describe("performance tiers", () => {
  it("gives each tier a different load", () => {
    const smooth = performanceBudget("smooth");
    const balanced = performanceBudget("balanced");
    const vivid = performanceBudget("vivid");
    assert.equal(smooth.webgl, false);
    assert.equal(smooth.voxels, false);
    assert.equal(smooth.blurPx, 0);
    assert.equal(smooth.deskFarGlow, false);
    assert.equal(smooth.proofPoints, 0);
    assert.equal(balanced.webgl, true);
    assert.equal(balanced.deskFarGlow, true);
    assert.ok(balanced.latticePoints > smooth.latticePoints);
    assert.ok(balanced.blurPx > smooth.blurPx);
    assert.ok(balanced.deskFps > smooth.deskFps);
    assert.equal(vivid.webgl, true);
    assert.equal(vivid.voxels, true);
    assert.ok(vivid.latticePoints > balanced.latticePoints);
    assert.ok(vivid.blurPx > balanced.blurPx);
    assert.ok(vivid.deskFps > balanced.deskFps);
    assert.equal(budgetsDiffer("smooth", "balanced"), true);
    assert.equal(budgetsDiffer("balanced", "vivid"), true);
    assert.equal(budgetsDiffer("vivid", "vivid"), false);
  });
});
