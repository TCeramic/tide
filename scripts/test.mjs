import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(root, "dist-test");
const entryPoints = [
  "src/core/playback/machine.test.ts",
  "src/core/playback/order.test.ts",
  "src/core/playback/queue-edit.test.ts",
  "src/core/audio-level.test.ts",
  "src/core/media-keys.test.ts",
  "src/core/playback/hits.test.ts",
  "src/core/playlist-pages.test.ts",
  "src/core/explore-queue.test.ts",
  "src/core/lyrics.test.ts",
  "src/api/cookie.test.ts",
  "src/api/netease.test.ts",
  "src/api/server.test.ts",
  "src/api/session.test.ts",
  "src/main/settings.test.ts",
  "src/core/tide-today.test.ts",
  "src/main/listen-log.test.ts",
  "src/core/command-bus.test.ts",
  "src/main/bus-files.test.ts",
  "src/main/command-server.test.ts",
];

await mkdir(outdir, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outdir,
  outbase: "src",
  sourcemap: true,
  external: ["node:test", "node:assert/strict", "NeteaseCloudMusicApi"],
  logLevel: "info",
});

const tests = entryPoints.map((entry) =>
  path.join(outdir, entry.slice("src/".length).replace(/\.ts$/, ".js")),
);

const result = spawnSync(process.execPath, ["--test", ...tests], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
