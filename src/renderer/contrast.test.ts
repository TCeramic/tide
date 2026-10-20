import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { composite, contrastRatio, type Rgb } from "./contrast";

describe("lyric contrast under the brightest wash", () => {
  it("keeps secondary and primary text at least 4.5 against the plate", () => {
    const css = fs.readFileSync("src/renderer/styles.css", "utf8");
    const alpha = Number(readVar(css, "--lyric-plate-alpha"));
    assert.ok(alpha >= 0.84);
    const tidePlate = readRgb(css, "--lyric-plate", ":root {");
    const duskPlate = readRgb(css, "--lyric-plate", "[data-theme=\"dusk\"]");
    const tideMuted = hex(readVar(css, "--tide-muted", ":root {"));
    const tideFg = hex(readVar(css, "--tide-fg", ":root {"));
    const duskMuted = hex(readVar(css, "--tide-muted", "[data-theme=\"dusk\"]"));
    const duskFg = hex(readVar(css, "--tide-fg", "[data-theme=\"dusk\"]"));
    const native = fs.readFileSync("src/renderer/native-shell.css", "utf8");
    const lensLyrics = 'html[data-shell="lens"][data-color-mode="light"] .lyrics-block';
    assert.deepEqual(hex(readVar(native, "--tide-fg", lensLyrics)), tideFg);
    assert.deepEqual(hex(readVar(native, "--tide-muted", lensLyrics)), tideMuted);
    const pointTokens = fs.readFileSync("src/renderer/vendor/design-systems/lattice/src/tokens.css", "utf8");
    const pointPlate = readRgb(native, "--lyric-plate", 'html[data-shell="lattice"] .lyrics-block');
    // Original refraction and additive points can reach white. This is a
    // stricter bound than the previous custom shader's hand-picked bright pixel.
    const white = { r: 255, g: 255, b: 255 };

    const cases = [
      { name: "lens aurora", fg: [tideMuted, tideFg], plate: tidePlate },
      { name: "lens ocean", fg: [duskMuted, duskFg], plate: duskPlate },
      { name: "lattice night", fg: [hex(readVar(pointTokens, "--text")), hex(readVar(pointTokens, "--text-dim"))], plate: pointPlate },
    ] as const;
    for (const row of cases) {
      const behind = composite({ ...row.plate, a: alpha }, white);
      for (const fg of row.fg) {
        const ratio = contrastRatio(fg, behind);
        assert.ok(ratio >= 4.5, `${row.name} ${ratio.toFixed(2)}`);
      }
    }
  });
});

describe("font preset binding", () => {
  it("lets the shell font follow --tide-font instead of the vendor family", () => {
    const css = fs.readFileSync("src/renderer/native-shell.css", "utf8");
    for (const shell of ["lens", "lattice"]) {
      const binding = new RegExp(
        `html\\[data-shell="${shell}"\\][^{]*\\{[^}]*font-family:\\s*var\\(--tide-font\\)`,
      );
      assert.match(css, binding, `${shell} never rebinds the vendored font family`);
    }
  });
});

function readVar(css: string, name: string, from = ""): string {
  const slice = from.length === 0 ? css : css.slice(css.indexOf(from));
  const match = slice.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match?.[1]) throw new Error(`missing ${name}`);
  return match[1].trim();
}

function readRgb(css: string, name: string, from: string): Rgb {
  const raw = readVar(css, name, from);
  const parts = raw.split(",").map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) throw new Error(raw);
  return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0 };
}

function hex(value: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match?.[1]) throw new Error(value);
  return {
    r: Number.parseInt(match[1].slice(0, 2), 16),
    g: Number.parseInt(match[1].slice(2, 4), 16),
    b: Number.parseInt(match[1].slice(4, 6), 16),
  };
}
