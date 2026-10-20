import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const label = "desktop-ui-preview-20261019";
const output = path.join(root, "release", label);
const sourceDirectory = path.join(output, "Tide-Desktop-UI-Preview-20261019-source");
const binaryName = "Tide-Desktop-UI-Preview-20261019-win-x64.zip";
const sourceName = "Tide-Desktop-UI-Preview-20261019-source.zip";
const execute = process.argv.includes("--package");
const sourceRoots = /^(src|vendor|build|scripts|licenses)\//;
const rootFiles = new Set(["package.json", "package-lock.json", "tsconfig.json", "LICENSE", "NOTICE", "README.md", "CHANGELOG.md", ".env.example", ".gitattributes", ".gitignore"]);
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
function quotePS(value) { return `'${value.replaceAll("'", "''")}'`; }
async function sha256(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
const listing = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", windowsHide: true });
if (listing.status !== 0) throw new Error("Cannot enumerate source files");
const files = [...new Set(listing.stdout.split("\0"))].filter(file =>
  file && (sourceRoots.test(file) || rootFiles.has(file)) &&
  !/(^|\/)(node_modules|artifacts|userData|cookies)(\/|$)/i.test(file) &&
  !/\.(log|cookie|pem|p12|pfx)$/i.test(file)
).sort();
for (const required of ["src/renderer/lyric-stage/index.ts", "build/lumisynth/entry.ts", "vendor/lumisynth/LICENSE", "vendor/lumisynth/NOTICE.md", "package-lock.json", "build/icon.ico"]) {
  if (!files.includes(required)) throw new Error(`Missing source input: ${required}`);
}
console.log(`${files.length} source files selected; output ${output}`);
if (!execute) {
  console.log("Preparation only. After validation, run node scripts/package-desktop-preview.mjs --package");
  process.exit(0);
}
await mkdir(output, { recursive: true });
for (const filename of [binaryName, sourceName]) {
  try { await stat(path.join(output, filename)); throw new Error(`Refusing to overwrite existing ${filename}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
// Build immediately before capturing source so the ZIP and source archive share
// the same accepted checkout. Call only after concurrent edits have finished.
const acceptedSource = new Map();
for (const file of files) acceptedSource.set(file, await sha256(path.join(root, file)));
run(process.execPath, [path.join(root, "scripts/build.mjs")]);
const manifest = [];
for (const file of files) {
  const source = path.join(root, file);
  const destination = path.join(sourceDirectory, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
  const digest = await sha256(destination);
  if (digest !== acceptedSource.get(file)) throw new Error(`Source changed during packaging: ${file}; wait for editing to finish`);
  manifest.push(`${digest}  ${file}`);
}
await writeFile(path.join(sourceDirectory, "SOURCE-SHA256.txt"), manifest.join("\n") + "\n");
await writeFile(path.join(sourceDirectory, "PREVIEW-BUILD.md"), `# Tide desktop UI preview source\n\nThis archive is the corresponding application source for ${binaryName}.\n\nBuild on Windows x64 with Node.js >=22:\n\n\`\`\`powershell\nnpm ci\nnpm run verify:design-systems\nnpm run typecheck\nnpm test\nnpm run build\nnpx electron-builder --win zip --x64\n\`\`\`\n\nTide's existing license is GPL-3.0-only. LumiSynth source is AGPL-3.0-only; see vendor/lumisynth/LICENSE, NOTICE.md and manifest.json. Third-party components retain their own notices. Required dependency versions are pinned in package-lock.json.\n\nThis preview keeps the existing internal 1.0.2 version number. It is not a formal release. SOURCE-SHA256.txt identifies the exact included source files.\n`);
run(process.execPath, [path.join(root, "node_modules/electron-builder/out/cli/cli.js"), "--win", "zip", "--x64", `--config.directories.output=${output}`, `--config.artifactName=${binaryName}`]);
for (const [file, digest] of acceptedSource) {
  if (await sha256(path.join(root, file)) !== digest) throw new Error(`Source changed while builder was running: ${file}; package requires a fresh build`);
}
run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Compress-Archive -Path ${quotePS(path.join(sourceDirectory, "*"))} -DestinationPath ${quotePS(path.join(output, sourceName))} -CompressionLevel Optimal`]);
await writeFile(path.join(output, "测试说明.txt"), `Tide 桌面 UI 测试包 2026-10-19\r\n\r\n解压 ${binaryName} 到新目录后运行 Tide.exe。不要直接在 ZIP 内运行。无需安装，不会覆盖稳定版程序目录。应用仍使用现有 Tide 用户配置，请先退出正在运行的稳定版，避免两个版本同时使用配置。保留原稳定版以便回退。\r\n\r\n重点测试：首页模块点击、最近播放、今日潮汐推荐、点阵复古封面、歌词页四种舞台、暂停/跳转、主题扩散、窗口缩放。反馈时请附主题、窗口大小、舞台名称和截图。\r\n\r\n舞台入口：播放页右上角「…」→「歌词舞台」→ 商籁 / 凝彩 / 绘光 / 花火。可切回常规歌词。\r\n\r\n这是预览包，内部版本暂为 1.0.2；本轮不发布正式 release。测试时若出现正式版更新提示可取消。\r\n\r\n相邻 source.zip 提供本包对应源代码和构建说明；SHA256SUMS.txt 可校验下载完整性。\r\n`);
const sums = [];
for (const file of (await readdir(output)).filter(file => /\.zip$/i.test(file)).sort()) sums.push(`${await sha256(path.join(output, file))}  ${file}`);
await writeFile(path.join(output, "SHA256SUMS.txt"), sums.join("\n") + "\n");
console.log(`Preview ready: ${path.join(output, binaryName)}`);
