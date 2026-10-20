// Exercise the actual preview mirror in a real iframe without a second WebGL renderer.
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require(process.env.TIDE_PLAYWRIGHT_MODULE || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const bundle = await build({
    entryPoints: [path.resolve(__dirname, '../src/renderer/theme-stage-preview.ts')],
    bundle: true, write: false, format: 'iife', globalName: 'Mirror', platform: 'browser',
  });
  const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="live" width="16" height="16"></canvas><iframe id="preview"></iframe>');
    const frame = page.frames().find(candidate => candidate !== page.mainFrame());
    await frame.setContent('<div class="lyrics-reading has-lyric-stage"><div class="tide-lyric-stage-host"></div><ol class="lyric-list"><li>Readable lyrics</li></ol></div>');
    await frame.addScriptTag({ content: bundle.outputFiles[0].text });
    const snapshot = await page.evaluate(() => {
      const canvas = document.querySelector('#live');
      const context = canvas.getContext('2d');
      context.fillStyle = '#ff0000'; context.fillRect(0, 0, 16, 16);
      return canvas.toDataURL();
    });
    await frame.evaluate(frame => { window.disposeMirror = Mirror.mirrorThemeStage(frame); }, snapshot);
    await frame.waitForFunction(() => document.querySelector('.tide-lyric-stage-host img')?.complete);
    assert.equal(await frame.locator('.tide-lyric-stage-host img').getAttribute('src'), snapshot);
    const copy = async color => {
      await page.evaluate(color => {
        const canvas = document.querySelector('#live');
        const context = canvas.getContext('2d');
        context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height);
        document.querySelector('#preview').contentWindow.dispatchEvent(new CustomEvent('tide:lyric-stage-frame', { detail: { canvas, pack: 'sonnet' } }));
      }, color);
      return frame.evaluate(() => Array.from(document.querySelector('.tide-lyric-stage-preview').getContext('2d').getImageData(0, 0, 1, 1).data));
    };
    assert.deepEqual(await copy('#ff0000'), [255, 0, 0, 255]);
    assert.deepEqual(await copy('#0000ff'), [0, 0, 255, 255]);
    assert.equal(await frame.locator('.tide-lyric-stage-host img').count(), 0);
    await frame.evaluate(() => window.disposeMirror());
    await copy('#00ff00');
    assert.equal(await frame.locator('canvas').evaluate(canvas => canvas.width), 0);
    await frame.evaluate(() => {
      document.querySelector('.tide-lyric-stage-host').replaceChildren();
      document.querySelector('.lyrics-reading').classList.add('has-lyric-stage');
      window.disposeMirror = Mirror.mirrorThemeStage(null);
    });
    assert.equal(await frame.locator('.lyrics-reading').evaluate(element => element.classList.contains('has-lyric-stage')), false);
    await frame.evaluate(() => window.disposeMirror());
    console.log('THEME_STAGE_SNAPSHOT_LIVE_FRAME_DISPOSE_FALLBACK passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
