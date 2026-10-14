import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { titleBarChrome } from "./titlebar";

describe("system title bar", () => {
  it("follows the shell", () => {
    const lens = titleBarChrome("lens");
    const lattice = titleBarChrome("lattice");
    assert.equal(lens.color, "#102833");
    assert.equal(lattice.color, "#07080b");
    assert.notEqual(lens.symbolColor, lattice.symbolColor);
    assert.equal(lattice.symbolColor, "#ece7da");
  });
});
