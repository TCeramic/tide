import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const nodeBundle = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: ["electron"],
  logLevel: "info",
};

await mkdir(dist, { recursive: true });

await build({
  ...nodeBundle,
  entryPoints: [path.join(root, "src/main/index.ts")],
  outfile: path.join(dist, "main.js"),
});

await build({
  ...nodeBundle,
  entryPoints: [path.join(root, "src/preload/index.ts")],
  outfile: path.join(dist, "preload.js"),
});

await build({
  ...nodeBundle,
  entryPoints: [path.join(root, "src/api/server.ts")],
  outfile: path.join(dist, "api/server.js"),
  external: [...nodeBundle.external, "NeteaseCloudMusicApi"],
});

await build({
  entryPoints: [path.join(root, "src/renderer/main.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  sourcemap: true,
  outfile: path.join(dist, "renderer.js"),
  logLevel: "info",
});

await build({
  entryPoints: [path.join(root, "src/renderer/desk.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  sourcemap: true,
  outfile: path.join(dist, "desk.js"),
  logLevel: "info",
});

await cp(path.join(root, "src/renderer/index.html"), path.join(dist, "index.html"));
await cp(path.join(root, "src/renderer/styles.css"), path.join(dist, "styles.css"));
await cp(path.join(root, "src/renderer/native-shell.css"), path.join(dist, "native-shell.css"));
const systems = path.join(root, "src/renderer/vendor/design-systems");
const cssFiles = {
  lens: ["lens/lab/design-system/tokens.css", "lens/lab/design-system/components.css"],
  lattice: ["lattice/src/tokens.css", "lattice/src/components.css"],
};
const styles = [];
for (const [name, files] of Object.entries(cssFiles)) {
  const css = await Promise.all(files.map(file => readFile(path.join(systems, file), "utf8")));
  // :root is outside an @scope's descendant matching range. Put the original
  // token declarations on the actual html root; scope only component selectors.
  styles.push(css[0].replaceAll(":root", `html[data-shell="${name}"]`));
  styles.push(`@scope (html[data-shell="${name}"]) {\n${css.slice(1).join("\n")}\n}`);
}
await writeFile(path.join(dist, "native-systems.css"), styles.join("\n"));
await cp(systems, path.join(dist, "design-systems"), { recursive: true });
await cp(path.join(root, "src/renderer/vendor/fonts"), path.join(dist, "fonts"), { recursive: true });
await cp(path.join(root, "src/renderer/native-fonts.css"), path.join(dist, "native-fonts.css"));
// The upstream standalone includes blocking Google Fonts stylesheet links.
// Keep the source intact; the packaged copy embeds the same Latin faces so its
// sandbox has no cross-origin font request or network-dependent blank first frame.
let showcase = await readFile(path.join(systems, "lattice/dist/lattice-showcase.html"), "utf8");
showcase = showcase.replace(/<link\b[^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, "");
let fontCss = "";
for (const [family, file, weights] of [["Doto", "Doto.ttf", "100 900"], ["Atkinson Hyperlegible Next", "AtkinsonHyperlegibleNext.ttf", "200 800"]]) {
  const font = await readFile(path.join(root, "src/renderer/vendor/fonts", file));
  fontCss += `@font-face{font-family:"${family}";src:url(data:font/ttf;base64,${font.toString("base64")}) format("truetype");font-weight:${weights};font-display:swap;}`;
}
showcase = showcase.replace("</head>", `<style>${fontCss}</style></head>`);
await writeFile(path.join(dist, "design-systems/lattice/dist/lattice-showcase.html"), showcase);
await cp(path.join(root, "src/renderer/desk.html"), path.join(dist, "desk.html"));
await cp(path.join(root, "src/renderer/desk.css"), path.join(dist, "desk.css"));
await cp(path.join(root, "build/icon.ico"), path.join(dist, "icon.ico"));
await cp(path.join(root, "build/icon.png"), path.join(dist, "icon.png"));

await cp(path.join(root, "licenses"), path.join(dist, "licenses"), { recursive: true });

await cp(path.join(root,"src/renderer/assets"),path.join(dist,"assets"),{recursive:true});
