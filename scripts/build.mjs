import { build } from "esbuild";
import { existsSync } from "node:fs";
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

const lumiSynthAlias = {
  name: "lumisynth-source-alias",
  setup(buildApi) {
    buildApi.onResolve({ filter: /^@\// }, (args) => {
      const basePath = path.resolve(root, "vendor/lumisynth/src", args.path.slice(2));
      const candidates = [
        basePath,
        ...[".ts", ".tsx", ".js", ".mjs"].map(extension => `${basePath}${extension}`),
        ...["index.ts", "index.tsx", "index.js"].map(file => path.join(basePath, file)),
      ];
      const resolved = candidates.find(candidate => existsSync(candidate));
      return resolved ? { path: resolved } : null;
    });
  },
};

await build({
  entryPoints: [path.join(root, "build/lumisynth/entry.ts")],
  outfile: path.join(dist, "lyric-stage-engine.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "TideLumiStageEngine",
  target: "es2022",
  // The stage always uses realtime playback; exact video decode is an unused
  // export path that optionally imports mediabunny.
  external: ["mediabunny"],
  plugins: [lumiSynthAlias],
  logLevel: "info",
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

await build({entryPoints:[path.join(root,"src/renderer/theme-preview.ts")],bundle:true,platform:"browser",format:"iife",target:"es2022",outfile:path.join(dist,"theme-preview.js"),logLevel:"info"});
await cp(path.join(root,"src/renderer/theme-preview.html"),path.join(dist,"theme-preview.html"));
await cp(path.join(root, "src/renderer/index.html"), path.join(dist, "index.html"));
await cp(path.join(root, "src/renderer/styles.css"), path.join(dist, "styles.css"));
await cp(path.join(root, "src/renderer/native-shell.css"), path.join(dist, "native-shell.css"));
await cp(path.join(root, "src/renderer/desktop-redesign.css"), path.join(dist, "desktop-redesign.css"));
await cp(path.join(root, "src/renderer/theme-defaults.css"), path.join(dist, "theme-defaults.css"));
await cp(path.join(root, "src/renderer/desktop-lyric-stage.css"), path.join(dist, "desktop-lyric-stage.css"));
await cp(path.join(root, "src/renderer/cover-halftone.css"), path.join(dist, "cover-halftone.css"));
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

await build({entryPoints:[path.join(root,"src/renderer/mini.ts")],bundle:true,platform:"browser",format:"iife",target:"es2022",sourcemap:true,outfile:path.join(dist,"mini.js"),logLevel:"info"});
await cp(path.join(root,"src/renderer/mini.html"),path.join(dist,"mini.html"));
await cp(path.join(root,"src/renderer/mini.css"),path.join(dist,"mini.css"));

await cp(path.join(root,"NOTICE"),path.join(dist,"licenses/Tide-NOTICE.txt"));

const lumiSynthLicenseDir = path.join(dist, "licenses/lumisynth");
await mkdir(lumiSynthLicenseDir, { recursive: true });
await cp(path.join(root, "vendor/lumisynth/LICENSE"), path.join(lumiSynthLicenseDir, "LICENSE"));
await cp(path.join(root, "vendor/lumisynth/NOTICE.md"), path.join(lumiSynthLicenseDir, "NOTICE.md"));
await cp(path.join(root, "vendor/lumisynth/manifest.json"), path.join(lumiSynthLicenseDir, "manifest.json"));
await cp(path.join(root, "vendor/lumisynth/third-party"), path.join(lumiSynthLicenseDir, "third-party"), { recursive: true });
