import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { LATTICE_DOT, LENS_PEAK, composite, contrastRatio, type Rgb } from "./contrast";

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
    const stage = fs.readFileSync("src/renderer/layers/stage.ts", "utf8");
    assert.match(stage, /rgba\(214, 248, 244, 0\.9\)/);
    assert.match(stage, /rgba\(255, 220, 186, 0\.88\)/);
    const shader = fs.readFileSync("src/renderer/layers/lens-field.ts", "utf8");
    assert.match(shader, /vec3\(0\.11, 0\.52, 0\.51\)/);
    assert.match(shader, /sheen \* 0\.09/);

    const cases = [
      { name: "tide lattice", fg: [tideMuted, tideFg], peak: LENS_PEAK.tide, dot: LATTICE_DOT.tide, plate: tidePlate },
      { name: "tide clear", fg: [tideMuted, tideFg], peak: LENS_PEAK.tide, dot: null, plate: tidePlate },
      { name: "dusk lattice", fg: [duskMuted, duskFg], peak: LENS_PEAK.dusk, dot: LATTICE_DOT.dusk, plate: duskPlate },
      { name: "dusk clear", fg: [duskMuted, duskFg], peak: LENS_PEAK.dusk, dot: null, plate: duskPlate },
    ] as const;
    for (const row of cases) {
      const bright = row.dot ? composite(row.dot, row.peak) : row.peak;
      const behind = composite({ ...row.plate, a: alpha }, bright);
      for (const fg of row.fg) {
        const ratio = contrastRatio(fg, behind);
        assert.ok(ratio >= 4.5, `${row.name} ${ratio.toFixed(2)}`);
      }
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
