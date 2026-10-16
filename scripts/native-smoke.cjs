// Real Electron/main/preload/API smoke; isolated data and a deterministic picker.
const { _electron } = require(process.env.TIDE_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.TIDE_NATIVE_OUTPUT || path.join(root, 'artifacts/native-smoke'));
fs.mkdirSync(out, { recursive: true });
const wav = Buffer.alloc(44 + 16000 * 2 * 4);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const audio = path.join(out, 'Tide QA - Silent.wav'); fs.writeFileSync(audio, wav);
let app;
(async () => {
  const executablePath = process.env.TIDE_TEST_EXE || require('electron');
  app = await _electron.launch({ executablePath, args: process.env.TIDE_TEST_EXE ? [] : [root],
    env: { ...process.env, TIDE_USER_DATA: path.join(out, 'profile-' + Date.now()), TIDE_API_PORT: '0', TIDE_BUS_PORT: '0', TIDE_SOFTWARE_GL: '1' }, timeout: 60000 });
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.tide));
  await page.evaluate(() => localStorage.setItem('tide.risk.ack', '1')); await page.reload();
  await page.waitForFunction(async () => (await window.tide.getHealth()).ok, null, { timeout: 30000 });
  assert.match(await page.title(), /Tide|潮汐/i);
  assert.equal(await page.locator('.home-card').count(), 6);
  await page.evaluate(() => window.tide.setAppearance({ shell: 'lattice', motion: 1 }));
  await page.waitForFunction(() => document.documentElement.dataset.shell === 'lattice');
  await page.waitForTimeout(2200);
  await page.evaluate(() => window.tide.setAppearance({ motion: 0 }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'packaged-lattice-home.png') });
  assert.equal(await page.getByRole('button', { name: '添加本地音乐', exact: true }).isVisible(), false);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, audio);
  await page.locator('.home-card').filter({ has: page.locator('h2', { hasText: '本地音乐' }) }).click();
  await page.getByRole('button', { name: '添加本地音乐', exact: true }).click();
  await page.waitForFunction(async () => (await window.tide.localTracks()).some(hit => hit.title === 'Silent'));
  await page.waitForFunction(() => document.querySelector('.hits')?.textContent.includes('Silent'));
  await page.screenshot({ path: path.join(out, 'packaged-local-import.png') });
  await page.getByRole('button', { name: '开始播放', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('data-view'), 'home');
  await page.waitForFunction(async () => { const state = await window.tide.getPlayback(); return state.status === 'playing' && state.positionMs > 200; }, null, { timeout: 20000 });
  await page.waitForFunction(async () => (await window.tide.getPlayback()).queue.some(track => track.durationMs === 4000));
  await page.evaluate(() => window.tide.pause());
  await page.evaluate(() => window.tide.seek(2500));
  await page.waitForFunction(async () => Math.abs((await window.tide.getPlayback()).positionMs - 2500) < 150);
  const health = await page.evaluate(() => window.tide.getHealth());
  assert.equal((await (await fetch(`http://127.0.0.1:${health.port}/health`)).json()).version, require('../package.json').version);
  assert.equal((await page.evaluate(() => window.tide.aiStatus())).configured, false);
  if (process.env.TIDE_LIVE_COVER) {
    const size = await page.evaluate(url => new Promise((resolve, reject) => {
      const image = new Image(); image.referrerPolicy = 'no-referrer';
      image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
      image.onerror = () => reject(new Error('live artwork load failed')); image.src = url;
    }), process.env.TIDE_LIVE_COVER);
    assert.ok(size[0] > 0 && size[1] > 0); console.log('LIVE_CDN_ARTWORK', size);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ native: 'pass', health: 'pass', import: 'pass', silentWavPlayback: 'pass', pageErrors: errors }));
  await app.close();
})().catch(async error => { console.error(error); await app?.close(); process.exitCode = 1; });
