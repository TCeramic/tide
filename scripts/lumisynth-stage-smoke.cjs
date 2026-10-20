const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const htmlPath = path.join(dist, `.lumisynth-stage-smoke-${process.pid}.html`);
const packs = ["sonnet", "tempera", "lumiere", "hanabi"];

app.commandLine.appendSwitch("enable-webgl");
app.commandLine.appendSwitch("ignore-gpu-blocklist");

async function main() {
  await fs.writeFile(htmlPath, "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><script src=\"./lyric-stage-engine.js\"></script></body></html>");
  const window = new BrowserWindow({
    show: false,
    width: 960,
    height: 640,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const consoleErrors = [];
  window.webContents.on("console-message", (_event, details) => {
    if (details.level >= 2) consoleErrors.push(details.message);
  });
  await window.loadFile(htmlPath);
  const result = await window.webContents.executeJavaScript(`(async () => {
    const engine = window.TideLumiStageEngine;
    if (!engine) throw new Error("local stage engine did not load");
    const theme = {
      name: "Tide fixture", backgroundColor: "#111923", primaryColor: "#f5f2ed",
      accentColor: "#83ddf1", secondaryColor: "#a8b8c8", fontStyle: "sans",
      animationIntensity: "normal", fontFamilyStack: ["Arial", "sans-serif"],
    };
    const lines = [
      { fullText: "Tide wakes with the morning light", startTime: 0.3, endTime: 3.8,
        words: [
          { text: "Tide", startTime: 0.3, endTime: 0.8 },
          { text: " wakes", startTime: 0.8, endTime: 1.45 },
          { text: " with", startTime: 1.45, endTime: 1.95 },
          { text: " the", startTime: 1.95, endTime: 2.25 },
          { text: " morning", startTime: 2.25, endTime: 3.0 },
          { text: " light", startTime: 3.0, endTime: 3.8 },
        ], translation: "潮汐伴着晨光醒来", romanization: "tide fixture" },
      { fullText: "Silver waves carry every sound", startTime: 4.5, endTime: 8.7,
        words: [
          { text: "Silver", startTime: 4.5, endTime: 5.25 },
          { text: " waves", startTime: 5.25, endTime: 5.9 },
          { text: " carry", startTime: 5.9, endTime: 6.6 },
          { text: " every", startTime: 6.6, endTime: 7.4 },
          { text: " sound", startTime: 7.4, endTime: 8.7 },
        ], translation: "银色浪潮承载每种声音", romanization: "stage smoke" },
    ];
    const tunings = {
      kernel: engine.DEFAULT_KERNEL_TUNING,
      packs: Object.fromEntries(${JSON.stringify(packs)}.map(id => [id, engine.getPack(id).tuning.defaults])),
    };
    async function pixels(dataUrl) {
      if (!dataUrl || !dataUrl.startsWith("data:image/")) throw new Error("captureFrame returned no image");
      const image = new Image(); image.src = dataUrl; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = 0, transparent = 0, hash = 2166136261;
      for (let index = 0; index < rgba.length; index += 4) {
        if (rgba[index + 3] > 8) visible += 1;
        if (rgba[index + 3] === 0) transparent += 1;
        hash = Math.imul(hash ^ rgba[index], 16777619);
        hash = Math.imul(hash ^ rgba[index + 1], 16777619);
        hash = Math.imul(hash ^ rgba[index + 2], 16777619);
        hash = Math.imul(hash ^ rgba[index + 3], 16777619);
      }
      return { width: canvas.width, height: canvas.height, visible, transparent, hash: hash >>> 0 };
    }
    const results = [];
    for (const pack of ${JSON.stringify(packs)}) {
      const program = engine.compileLumiProgram({
        lines, seed: "tide-four-pack-smoke", direction: { mode: "single", pack, shotMixing: false },
      });
      const kernel = await engine.LumiKernel.create({
        width: 960, height: 640, resolution: 0.75, program, lines, audio: null,
        theme, tunings, metadata: { title: "Tide stage smoke", artist: "Fixture", album: "No account" },
        coverColors: ["#83ddf1", "#d8a9ca"], cover: null, layerImages: new Map(),
        manualRender: true, omitBackground: true, transparent: true, videoMode: "realtime",
      });
      try {
        kernel.renderAt(1.1);
        const first = await pixels(await kernel.captureFrame());
        kernel.renderAt(6.5);
        const second = await pixels(await kernel.captureFrame());
        kernel.renderAt(6.5);
        const paused = await pixels(await kernel.captureFrame());
        if (first.visible < 50 || second.visible < 50) throw new Error(pack + " produced an empty transparent frame");
        if (first.hash === second.hash) throw new Error(pack + " seek did not change the rendered pixels");
        if (second.hash !== paused.hash) throw new Error(pack + " repeated paused timestamp changed pixels");
        results.push({ pack, first, seek: second, pause: paused });
      } finally {
        kernel.destroy();
      }
    }
    return results;
  })()`);
  assert.equal(result.length, packs.length, "all four original packs should render");
  for (const packResult of result) {
    assert.ok(packResult.first.visible >= 50, `${packResult.pack}: first frame is empty`);
    assert.ok(packResult.first.transparent > 50, `${packResult.pack}: transparent stage has an opaque rectangular backdrop`);
    assert.notEqual(packResult.first.hash, packResult.seek.hash, `${packResult.pack}: seek did not change pixels`);
    assert.equal(packResult.seek.hash, packResult.pause.hash, `${packResult.pack}: same paused frame is unstable`);
  }
  console.log(JSON.stringify({ packs: result, consoleErrors }, null, 2));
  if (consoleErrors.length) throw new Error(`Chromium reported console errors: ${consoleErrors.join(" | ")}`);
  window.destroy();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  try { await fs.unlink(htmlPath); } catch {}
  app.quit();
});
