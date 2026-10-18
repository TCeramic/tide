// Source-built Android auth/favorites UI regression fixture. Uses a deterministic
// native bridge and never connects to a device or a music account.
const { chromium } = require(process.env.TIDE_PLAYWRIGHT_MODULE || 'playwright');
const esbuild = require('esbuild');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-android-auth-'));
const bundlePath = path.join(temp, 'mobile.js');
const mobileEntry = path.join(root, 'android/ui/mobile.ts');
const mobileSource = fs.readFileSync(mobileEntry, 'utf8');
esbuild.buildSync({
  // Append a test-only bridge in the same TypeScript module so the fixture can
  // drive its real closure state without adding debug exports to production.
  stdin: {
    // Keep the production bridge exactly as shipped. Only expose the private
    // formatting helper needed by this fixture; never replace TideMobile.
    contents: `${mobileSource}\nwindow.__androidAuthSmoke = { clock };\n`,
    resolveDir: path.dirname(mobileEntry), sourcefile: mobileEntry, loader: 'ts'
  }, bundle: true,
  platform: 'browser', format: 'iife', target: 'chrome80', outfile: bundlePath,
  minify: true, logLevel: 'silent'
});

const files = new Map([
  ['/index.html', path.join(root, 'android/ui/index.html')],
  ['/mobile.js', bundlePath],
  ['/mobile.css', path.join(root, 'android/ui/mobile.css')],
  ['/native-fonts.css', path.join(root, 'src/renderer/native-fonts.css')],
  ['/native-systems.css', path.join(root, 'android/assets/web/native-systems.css')],
  ['/assets/today-tide.png', path.join(root, 'src/renderer/assets/today-tide.png')]
]);
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  const file = files.get(pathname) || (pathname.startsWith('/fonts/')
    ? path.join(root, 'src/renderer/vendor/fonts', pathname.slice('/fonts/'.length))
    : null);
  const resolved = file && path.resolve(file);
  if (!file || !(resolved.startsWith(path.resolve(root) + path.sep) || resolved.startsWith(path.resolve(temp) + path.sep))) {
    res.writeHead(404).end();
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});

const waitForQrCheckCount = (page, count) => page.waitForFunction(
  expected => window.fixtureActions.filter(a => a.action === 'qr-check').length >= expected,
  count,
  { timeout: 5000 }
);
const latestQrCheck = page => page.evaluate(() => {
  const rows = window.fixtureActions.filter(a => a.action === 'qr-check');
  return rows[rows.length - 1];
});
const assertActivePoll = async (page, requestId, key) => {
  assert.deepEqual((await latestQrCheck(page)).data, { requestId, key }, 'poll requests keep their challenge identity');
};
const result = (page, data) => page.evaluate(payload => window.TideMobile.result(payload), data);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 421, height: 926 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const songs = [
        { id: '2', title: 'Remote favorite', artist: 'Fixture artist', uri: '', cover: 'assets/today-tide.png', duration: 240000 },
        { id: '3', title: 'Remote song', artist: 'Fixture artist', uri: '', cover: 'assets/today-tide.png', duration: 240000 }
      ];
      const state = {
        library: [], favorites: [], queue: songs, index: 0, playing: true, loading: false, error: '',
        position: 30000, duration: 240000, lyrics: [], likesKnown: true, likedIds: [2],
        loggedIn: false, nickname: '', appearance: {
          shell: 'lens', lensMode: 'dark', latticeMode: 'dark', theme: 'tide', background: 'paper',
          performance: 'balanced', chromeVisible: true, stageLevel: 1, motion: 1,
          lattice: false, preset: 'flow', fontPreset: 'system', fontFamily: ''
        }
      };
      window.fixtureState = state;
      window.fixtureActions = [];
      window.TideNative = { dispatch(action, payload) {
        const data = JSON.parse(payload);
        window.fixtureActions.push({ action, data });
        if (action === 'ready' || action === 'appearance') {
          if (action === 'appearance') Object.assign(state.appearance, data);
          setTimeout(() => window.TideMobile.setState(structuredClone(state)), 20);
        }
        if (action === 'play') {
          state.index = songs.findIndex(song => song.id === String(data.id));
          window.TideMobile.setState(structuredClone(state));
        }
      } };
    });
    await page.goto(`http://127.0.0.1:${address.port}/index.html`);
    await page.waitForFunction(() => {
      const bridge = window.TideMobile;
      return bridge && ['setState', 'result', 'back', 'progress', 'go'].every(name => typeof bridge[name] === 'function');
    }, null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__androidAuthSmoke.clock(90000)), '1:30', 'only the non-exported clock helper is exposed to tests');
    await page.waitForTimeout(250);
    await page.evaluate(() => window.TideMobile.go('playing'));
    await page.waitForTimeout(80);

    // Unknown server state is reported as syncing, not as a confirmed unliked state.
    const like = page.locator('#player-like');
    await page.evaluate(() => {
      window.fixtureState.likesKnown = false;
      window.fixtureState.likedIds = [];
      window.TideMobile.setState(structuredClone(window.fixtureState));
    });
    assert.equal(await like.getAttribute('aria-busy'), 'true', 'unknown server state is visibly syncing');
    assert.match(await like.getAttribute('title'), /同步网易云/);
    assert.equal(await like.getAttribute('aria-pressed'), 'false', 'unknown state does not claim the song is liked');

    // Server snapshot ids may be numeric while song ids arrive as strings.
    await page.evaluate(() => {
      window.fixtureState.likesKnown = true;
      window.fixtureState.likedIds = [2];
      window.TideMobile.setState(structuredClone(window.fixtureState));
    });
    await page.waitForFunction(() => document.querySelector('#player-like')?.getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
    assert.equal(await like.getAttribute('aria-pressed'), 'true', 'server-confirmed numeric ID paints a string-ID song as liked');
    const heartStyle = await like.locator('svg').evaluate(svg => ({
      fill: getComputedStyle(svg).fill,
      stroke: getComputedStyle(svg).stroke,
      color: getComputedStyle(svg).color
    }));
    assert.equal(heartStyle.fill, heartStyle.color, 'the liked heart is visibly filled with its active color');
    assert.equal(await like.isDisabled(), false);

    await like.click();
    await page.waitForFunction(() => window.fixtureActions.some(a => a.action === 'favorite'));
    assert.equal(await like.isDisabled(), true, 'favorite is disabled while the server write is pending');
    await like.evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(await page.evaluate(() => window.fixtureActions.filter(a => a.action === 'favorite').length), 1, 'a second click cannot submit a duplicate write');
    assert.equal((await page.evaluate(() => window.fixtureActions.find(a => a.action === 'favorite'))).data.id, '2');

    await result(page, { type: 'favorite', id: '2', pending: false, message: '网络环境异常' });
    assert.equal(await like.getAttribute('aria-pressed'), 'true', 'a failed write preserves the last server-confirmed state');
    assert.equal(await like.isDisabled(), false);
    assert.equal(await page.locator('#mobile-toast').textContent(), '网络环境异常', 'write failure is shown explicitly');

    await like.click();
    assert.equal(await like.isDisabled(), true);
    await page.evaluate(() => {
      window.fixtureState.likedIds = [];
      window.TideMobile.setState(structuredClone(window.fixtureState));
    });
    await result(page, { type: 'favorite', id: '2', pending: false, message: '已取消喜欢' });
    assert.equal(await like.getAttribute('aria-pressed'), 'false', 'successful server state refresh removes the filled heart');
    assert.equal(await like.isDisabled(), false);

    // Open QR login. Two requests finish out of order; only the newest request
    // may replace the active challenge. A request id is part of the native bridge contract.
    await page.locator('#player-back').click();
    await page.locator('#account-button').click();
    await page.locator('#qr-start').click();
    await page.locator('#qr-start').click();
    await page.waitForFunction(() => window.fixtureActions.filter(a => a.action === 'qr-key').length >= 2);
    const qrRequests = await page.evaluate(() => window.fixtureActions.filter(a => a.action === 'qr-key').map(a => a.data));
    assert.notEqual(qrRequests[0].requestId, qrRequests[1].requestId, 'each QR generation has a distinct correlation id');
    await result(page, { type: 'qr-key', key: 'newest-challenge', requestId: qrRequests[1].requestId });
    await result(page, { type: 'qr-key', key: 'stale-challenge', requestId: qrRequests[0].requestId });

    await waitForQrCheckCount(page, 1);
    const activeRequestId = qrRequests[1].requestId;
    assert.deepEqual((await latestQrCheck(page)).data, { requestId: activeRequestId, key: 'newest-challenge' }, 'the active challenge wins when key responses arrive out of order');
    await sleep(2350);
    assert.equal(await page.evaluate(() => window.fixtureActions.filter(a => a.action === 'qr-check').length), 1, 'the timer does not overlap an in-flight status request');

    // A keyless stale error is ambiguous and must not mutate the current poll state.
    const pendingStatus = await page.locator('#qr-status').textContent();
    await result(page, { type: 'qr-check', requestId: qrRequests[0].requestId, key: 'stale-challenge', code: 0, message: 'old request error' });
    await result(page, { type: 'qr-check', requestId: activeRequestId, code: 0, message: 'challenge key missing' });
    assert.equal(await page.locator('#qr-status').textContent(), pendingStatus, 'a challenge-less stale response is ignored');
    await sleep(2350);
    assert.equal(await page.evaluate(() => window.fixtureActions.filter(a => a.action === 'qr-check').length), 1, 'a stale error cannot release the current singleflight lock');

    const poll = code => result(page, { type: 'qr-check', requestId: activeRequestId, key: 'newest-challenge', code });
    await poll(801);
    assert.match(await page.locator('#qr-status').textContent(), /等待扫描/);
    await waitForQrCheckCount(page, 2);
    await assertActivePoll(page, activeRequestId, 'newest-challenge');
    await poll(802);
    assert.match(await page.locator('#qr-status').textContent(), /已扫码/);
    await waitForQrCheckCount(page, 3);
    await assertActivePoll(page, activeRequestId, 'newest-challenge');
    await poll(200);
    assert.match(await page.locator('#qr-status').textContent(), /确认登录授权/);
    assert.doesNotMatch(await page.locator('#qr-status').textContent(), /扫码受限/);
    assert.equal(await page.locator('#login-dialog').isVisible(), true, 'HTTP success without confirmation does not close login');
    await waitForQrCheckCount(page, 4);
    await assertActivePoll(page, activeRequestId, 'newest-challenge');
    await poll(0);
    assert.match(await page.locator('#qr-status').textContent(), /连接暂时中断/);
    assert.doesNotMatch(await page.locator('#qr-status').textContent(), /扫码受限/);
    assert.equal(await page.locator('#login-dialog').isVisible(), true, 'transient network status keeps polling active');
    await waitForQrCheckCount(page, 5);
    await assertActivePoll(page, activeRequestId, 'newest-challenge');
    await poll(803);
    assert.equal(await page.locator('#qr-status').textContent(), '登录成功');
    await page.waitForFunction(() => !document.querySelector('#login-dialog').open, null, { timeout: 2000 });

    // Close and reopen invalidates any delayed response from the previous dialog session.
    await page.locator('#account-button').click();
    await page.locator('#qr-start').click();
    await page.waitForFunction(() => window.fixtureActions.filter(a => a.action === 'qr-key').length >= 3);
    const thirdRequest = await page.evaluate(() => window.fixtureActions.filter(a => a.action === 'qr-key').at(-1).data);
    await result(page, { type: 'qr-key', key: 'closing-challenge', requestId: thirdRequest.requestId });
    await page.locator('#close-login').click();
    await page.locator('#account-button').click();
    await result(page, { type: 'qr-check', requestId: thirdRequest.requestId, key: 'closing-challenge', code: 803 });
    assert.notEqual(await page.locator('#qr-status').textContent(), '登录成功', 'a delayed result after closing the dialog is ignored');
    assert.equal(await page.locator('#login-dialog').isVisible(), true, 'a stale success cannot close a newly opened login dialog');

    assert.deepEqual(errors, []);
    console.log('ANDROID_AUTH_FAVORITE_AND_QR_REGRESSIONS passed');
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
  server.close();
  fs.rmSync(temp, { recursive: true, force: true });
});
