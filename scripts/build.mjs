import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
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
await cp(path.join(root, "src/renderer/desk.html"), path.join(dist, "desk.html"));
await cp(path.join(root, "src/renderer/desk.css"), path.join(dist, "desk.css"));
await cp(path.join(root, "build/icon.ico"), path.join(dist, "icon.ico"));
await cp(path.join(root, "build/icon.png"), path.join(dist, "icon.png"));
