import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { titleBarChrome } from "./titlebar";

describe("system title bar", () => {
  it("follows the shell", () => {
    const lens = titleBarChrome("lens");
    const lattice = titleBarChrome("lattice");
    assert.equal(lens.color, "#00000000");
    assert.equal(lens.symbolColor, "#22252b");
    assert.equal(titleBarChrome("lens", "dusk").color, "#00000000");
    assert.equal(titleBarChrome("lens", "dusk").symbolColor, "#f2f7fc");
    assert.equal(lattice.color, "#00000000");
    assert.notEqual(lens.symbolColor, lattice.symbolColor);
    assert.equal(lattice.symbolColor, "#ece7da");
  });
});
