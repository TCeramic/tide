// Isolated Android-WebView renderer fixture for daily playlist caching and paused lyrics.
const { chromium } = require(process.env.TIDE_PLAYWRIGHT_MODULE || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const root = path.resolve('android/assets/web');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});

const userLists = [{ id: 'user-1', name: '保留的自建歌单', trackCount: 3, cover: '' }];
const recommendedLists = [{ id: 'rec-1', name: '已有推荐歌单', trackCount: 12, cover: '' }];
const song = (id, title) => ({ id, title, artist: 'Tide Fixture', uri: 'https://fixture.invalid/' + id, cover: '', duration: 180000 });

(async () => {
  await new Promise(resolve => server.listen(4186, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('tide-fixture-initialized')) {
        localStorage.removeItem('tide.android.today.v1');
        sessionStorage.setItem('tide-fixture-initialized', '1');
      }
      const tracks = [
        { id: 'resume-1', title: '恢复歌曲', artist: 'Fixture Artist', uri: 'https://fixture.invalid/resume-1', cover: '', duration: 180000 },
      ];
      const state = {
        library: tracks, favorites: [], queue: tracks, index: 0, playing: false, loading: false,
        error: '', position: 12500, duration: 180000,
        lyrics: [{ time: 0, text: '暂停前一句' }, { time: 10000, text: '暂停时当前歌词' }],
        translations: [], romaji: [], likedIds: [], likesKnown: true,
        appearance: { shell: 'lens', lensMode: 'dark', latticeMode: 'dark', theme: 'tide', background: 'paper', performance: 'balanced', chromeVisible: true, stageLevel: 1, motion: 1, lattice: false, preset: 'flow', fontPreset: 'system', fontFamily: '' },
        loggedIn: true, accountId: '163-user-100', nickname: 'Fixture Account', avatar: '', repeat: 'list',
      };
      window.fixtureState = state;
      window.fixtureActions = [];
      window.TideNative = {
        dispatch(action, payload) {
          const data = JSON.parse(payload);
          window.fixtureActions.push({ action, data });
          if (action === 'ready') setTimeout(() => window.TideMobile.setState(structuredClone(state)), 15);
          if (action === 'playlists') setTimeout(() => window.TideMobile.result({ type: 'playlists', playlists: [{ id: 'user-1', name: '保留的自建歌单', trackCount: 3, cover: '' }], recommended: [{ id: 'rec-1', name: '已有推荐歌单', trackCount: 12, cover: '' }] }), 15);
          if (action === 'daily') {
            const rows = data.refresh ? [{ id: 'today-new', title: '手动刷新后的歌曲' }] : [{ id: 'today-old', title: '今日潮汐歌曲' }];
            setTimeout(() => window.TideMobile.result({ type: 'daily', items: rows }), 15);
          }
          if (action === 'daily-recommend') setTimeout(() => window.TideMobile.result({ type: 'daily-recommend', items: [{ id: 'recommend-song', title: '每日推荐歌曲' }] }), 15);
        },
      };
    });

    await page.goto('http://127.0.0.1:4186/index.html');
    await page.waitForTimeout(700);
    await page.evaluate(() => window.TideMobile.go('playing'));
    await page.locator('#player-cover').click();
    assert.equal(await page.locator('.lyric-entry.active').textContent(), '暂停时当前歌词', 'paused playback highlights the lyric at its saved position');
    assert.equal(await page.locator('#lyric-view').isVisible(), true);

    await page.evaluate(() => window.TideMobile.go('home'));
    await page.locator('#cloud-card').click();
    await page.waitForSelector('[data-action="daily-recommend"]');
    assert.equal(await page.locator('[data-action="daily"]').count(), 1);
    assert.equal(await page.locator('[data-action="daily-recommend"]').count(), 1, 'special daily-recommend entry exists');
    assert.equal(await page.locator('[data-list="user-1"]').count(), 1, 'existing owned playlist remains');
    assert.equal(await page.locator('[data-list="rec-1"]').count(), 1, 'existing recommended playlist remains');
    await page.locator('[data-action="daily-recommend"]').click();
    await page.waitForSelector('[data-play="recommend-song"]');
    assert.equal(await page.locator('#content-page h1').textContent(), '每日推荐');

    await page.evaluate(() => window.TideMobile.go('home'));
    await page.locator('#daily-card').click();
    await page.waitForSelector('[data-play="today-old"]');
    let dailyCalls = await page.evaluate(() => window.fixtureActions.filter(x => x.action === 'daily'));
    assert.deepEqual(dailyCalls.map(x => x.data.refresh), [false], 'first visit uses native cache when available and generates only once');

    await page.evaluate(() => window.TideMobile.go('home'));
    await page.locator('#daily-card').click();
    await page.waitForSelector('[data-play="today-old"]');
    dailyCalls = await page.evaluate(() => window.fixtureActions.filter(x => x.action === 'daily'));
    assert.deepEqual(dailyCalls.map(x => x.data.refresh), [false], 're-entering today tide reuses cached rows without a fetch');

    await page.locator('[data-action="refresh-collection"]').click();
    await page.waitForSelector('[data-play="today-new"]');
    dailyCalls = await page.evaluate(() => window.fixtureActions.filter(x => x.action === 'daily'));
    assert.deepEqual(dailyCalls.map(x => x.data.refresh), [false, true], 'only explicit refresh requests fresh songs');

    await page.reload();
    await page.waitForTimeout(450);
    await page.locator('#daily-card').click();
    await page.waitForSelector('[data-play="today-new"]');
    dailyCalls = await page.evaluate(() => window.fixtureActions.filter(x => x.action === 'daily'));
    assert.equal(dailyCalls.length, 0, 'today tide cache survives app renderer restart for the same account');

    await page.evaluate(() => window.TideMobile.setState({ ...window.fixtureState, loggedIn: true, accountId: '163-user-200', nickname: 'Other Fixture Account' }));
    await page.locator('#home-button').click();
    await page.locator('#daily-card').click();
    await page.waitForSelector('[data-play="today-old"]');
    dailyCalls = await page.evaluate(() => window.fixtureActions.filter(x => x.action === 'daily'));
    assert.deepEqual(dailyCalls.map(x => x.data.refresh), [false], 'daily cache is invalidated when the account id changes');
    assert.deepEqual(errors, []);
    console.log('ANDROID_DAILY_RECOMMEND_TODAY_CACHE_ACCOUNT_INVALIDATION_PAUSED_LYRICS passed');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
