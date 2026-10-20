// Real renderer visual smoke with synthetic playback/library data and no account access.
const { chromium } = require(process.env.TIDE_PLAYWRIGHT_MODULE || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const dist = path.resolve(__dirname, '../dist');
const output = path.resolve(process.env.TIDE_DESKTOP_REDESIGN_OUTPUT || path.join(__dirname, '../artifacts/desktop-redesign-smoke'));
fs.mkdirSync(output, { recursive: true });
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
let browser;
const noCorsCoverServer = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.end('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><linearGradient id="g"><stop stop-color="#132230"/><stop offset="1" stop-color="#c9d3bb"/></linearGradient></defs><rect width="256" height="256" fill="url(#g)"/><circle cx="128" cy="128" r="62" fill="#f5e9b7"/></svg>');
});

const server = http.createServer((req, res) => {
  if (req.url === '/cover.svg') {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><linearGradient id="g"><stop stop-color="#79d8cf"/><stop offset="1" stop-color="#514da9"/></linearGradient></defs><rect width="256" height="256" fill="url(#g)"/><circle cx="128" cy="128" r="62" fill="#f5e9b7"/></svg>');
    return;
  }
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(`${dist}${path.sep}`)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    if (path.extname(file) === '.js') res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(data);
  });
});

function makeFixtureData(port) {
  const fixtureCover = `http://127.0.0.1:${port}/cover.svg`;
  const tracks = Array.from({ length: 8 }, (_, index) => ({
    id: `fixture-${index + 1}`,
    title: ['海面上的风', '潮汐回声', '沿着月光行走', '远岸来信'][index % 4],
    artist: ['林间声', '海雾乐队', '南方的岛'][index % 3],
    albumTitle: '潮汐测试集', albumId: 'fixture-album', durationMs: 225000,
    playable: true, cover: fixtureCover,
  }));
  const snapshot = { status: 'paused', queue: tracks, index: 0, positionMs: 37500, volume: .8, error: null, repeat: 'all', shuffle: false, explore: false };
  const listeners = {};
  const appearance = { chromeVisible: true, stageLevel: 1, theme: 'tide', motion: 0, lattice: false, shell: 'lens', preset: 'flow', performance: 'smooth', background: 'paper', fontPreset: 'system', fontFamily: '', emblem: 'auto', lensMode: 'light', latticeMode: 'dark' };
  const lines = Array.from({ length: 14 }, (_, index) => {
    const text = `潮声越过第 ${index + 1} 道岸线`;
    return { timeMs: index * 5000, durationMs: 4500, text, words: Array.from(text, (word, wordIndex) => ({ text: word, timeMs: index * 5000 + wordIndex * 180, durationMs: 180 })) };
  });
  const hits = tracks.map((track, index) => ({ ...track, id: `result-${index + 1}`, playable: true }));
  const cloudPlaylists = [{ id: 'cloud-favorites', name: '远岸收藏', trackCount: 8, cover: fixtureCover }];
  const localRows = tracks.slice(0, 3).map((track, index) => ({ ...track, id: `local-${index + 1}`, title: `本地曲目 ${index + 1}`, playable: true }));
  const session = { ok: true, state: 'logged_in', user: { nickname: '桌面验收夹具' }, playlists: cloudPlaylists };
  const tideLists = [{ id: 'tide-list-fixture', name: '本次收藏', description: '仅供UI验收的合成歌单', trackCount: 3, cover: fixtureCover, songs: localRows, updatedAt: 1 }];
  const deskLyrics = { open: false, locked: false, x: null, y: null, fontSize: 48, color: '#f7fbfc', opacity: 1, highlightFollow: true, motion: false, glow: .4, pair: false, wave: false, orientation: 'horizontal', motionLevel: 0, backdrop: 0 };
  const data = {
    getPlayback: { ...snapshot }, getHealth: { ok: true, service: 'fixture', version: 'smoke', busPort: 39272 }, getSession: session,
    getMediaShortcuts: { shortcuts: {}, messages: [], captureMediaKeys: false }, getQuality: 'standard', getDeskLyrics: deskLyrics,
    getAppearance: appearance, getMiniPlayer: { open: false }, aiStatus: { configured: false, provider: 'fixture', model: '' },
    lyric: { ok: true, trackId: tracks[0].id, lines, translation: lines.map(row => ({ timeMs: row.timeMs, text: `译文：${row.text}` })), romaji: [], yrc: lines, source: 'fixture', credits: [] },
  };
  return { data, fixtureCover, tracks, hits, cloudPlaylists, localRows, session, tideLists };
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => noCorsCoverServer.listen(0, '127.0.0.1', resolve));
  const noCorsCoverPort = noCorsCoverServer.address().port;
  browser = await chromium.launch({ channel: process.env.TIDE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined), headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 650 }, reducedMotion: 'reduce' });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  const fixture = makeFixtureData(port);
  await page.addInitScript(({ data, fixtureCover, hits, localRows, tideLists }) => {
    if (window.top !== window) return;
    localStorage.setItem('tide.risk.ack', '1');
    window.fixtureCover = fixtureCover;
    const snapshot = structuredClone(data.getPlayback);
    const appearance = { ...data.getAppearance };
    const listeners = {};
    const notify = (name, value) => { for (const callback of listeners[name] || []) callback(value); };
    const subscribe = name => callback => { (listeners[name] ||= []).push(callback); return () => { listeners[name] = listeners[name].filter(item => item !== callback); }; };
    const methods = {
      mediaKeys: {},
      setAppearance: async patch => { Object.assign(appearance, patch); for (const callback of listeners.onAppearance || []) await callback({ ...appearance }); return { ...appearance }; },
      playHits: async (rows, index) => { snapshot.queue = rows; snapshot.index = index; snapshot.status = 'playing'; notify('onPlayback', { ...snapshot }); return { ...snapshot }; },
      fixtureSetPlayback: patch => { Object.assign(snapshot, patch); notify('onPlayback', { ...snapshot }); },
      tidePlaylists: async () => tideLists,
      tideToday: async () => ({ ok: true, hits, message: null }),
      dailyRecommend: async () => ({ ok: true, kind: 'songs', hits }),
      // `/personalized` shape: enough rows to exercise the separator + cards under 我的歌单.
      // 12 张 = 一页半，用来验证「换一批」在池子里轮换时页面不会重复或清空。
      recommendPlaylists: async () => ({ ok: true, playlists: Array.from({ length: 12 }, (_, index) => ({
        id: `94${String(index + 1).padStart(4, '0')}`,
        name: ['深夜情绪收容所', '通勤路上的浪潮', '凌晨三点的证明树', '雨天窗边的钢琴', '旧磁带与回声', '海边的低音提琴'][index % 6] + (index >= 6 ? ' II' : ''),
        trackCount: 20 + index * 3,
        cover: fixtureCover,
      })) }),
      radar: async () => ({ ok: true, kind: 'songs', hits }), personalFm: async () => ({ ok: true, kind: 'songs', hits }),
      playlistTracks: async () => ({ ok: true, kind: 'songs', hits, source: { playlistId: 'cloud-favorites', offset: 0 }, nextOffset: 0, hasMore: false }),
      localTracks: async () => localRows, addLocalTracks: async () => localRows,
      search: async (keywords, type) => type === 1 ? { ok: true, kind: 'songs', hits: hits.map(row => ({ ...row, title: `${keywords} · ${row.title}` })) } : { ok: true, kind: 'songs', hits },
      albumTracks: async () => ({ ok: true, kind: 'songs', hits }), artistSongs: async () => ({ ok: true, kind: 'songs', hits }),
      getSession: async () => data.getSession, likedIds: async () => ({ ok: true, known: true, ids: [] }),
      getMediaShortcuts: async () => data.getMediaShortcuts, getQuality: async () => data.getQuality,
      setQuality: async value => value, setCaptureMediaKeys: async value => ({ ok: true, captureMediaKeys: value }),
      setMediaShortcuts: async shortcuts => ({ ok: true, shortcuts, messages: [] }),
      likeSong: async () => ({ ok: true, liked: true }), replaceUpcoming: async rows => ({ ...snapshot, queue: [...snapshot.queue.slice(0, 1), ...rows] }),
      windowAction: async () => undefined, setMiniPlayer: async () => ({ open: false }), setFullscreen: async () => undefined,
      backdropUrl: async () => null,
    };
    for (const name of ['onAppearance', 'onPlayback', 'onHealth', 'onFullscreen', 'onEvent', 'onRenderActive', 'onLikeState', 'onNotice', 'onCloseRequest']) methods[name] = subscribe(name);
    window.fixtureSetPlayback = methods.fixtureSetPlayback;
    window.tide = new Proxy(methods, {
      get(target, key) {
        if (key in target) return target[key];
        if (String(key).startsWith('on')) return subscribe(key);
        return async () => data[key] ?? { ok: false, message: 'isolated desktop UI fixture' };
      },
    });
  }, fixture);

  const pages = ['home', 'home-scroll', 'explore', 'library-playlists', 'library-local', 'search', 'footprint', 'proof', 'queue', 'settings', 'playing', 'lyric-stage'];
  const homeBoundsChecks = [];
  const scrollChecks = [];
  const stageChecks = [];
  let stageFallbackChecked = false;
  let coverCorsFallbackChecked = false;
  const capture = async (shell, mode, viewport) => {
    await page.setViewportSize(viewport);
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => document.documentElement.dataset.view === 'home' && Boolean(document.querySelector('.home-grid')));
    await page.waitForFunction(() => document.querySelector('.search button[type="submit"]')?.disabled === false);
    if (shell === 'lens' && mode === 'light' && viewport.width === 900) {
      await page.evaluate(() => {
        window.fixtureSetPlayback({ status: 'playing', index: 0 });
        window.fixtureSetPlayback({ status: 'playing', index: 1 });
      });
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('.home-recent-play').length === 2);
      assert.deepEqual(await page.locator('.home-recent-title').allTextContents(), ['潮汐回声', '海面上的风'], 'recent playback must survive a renderer restart in newest-first order');
      await page.waitForFunction(() => document.querySelector('.search button[type="submit"]')?.disabled === false);
    }
    await page.evaluate(({ shell: nextShell, mode: nextMode }) => window.tide.setAppearance({ shell: nextShell, lensMode: nextMode, latticeMode: nextMode, background: 'paper', performance: 'smooth', motion: 0, emblem: 'auto' }), { shell, mode });
    await page.waitForTimeout(350);
    if (process.env.TIDE_STAGE_FOCUSED === '1') {
      await page.locator('.home-hero').evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await page.waitForFunction(() => document.documentElement.dataset.view === 'playing');
      const trigger = page.locator('.lyric-options-trigger');
      const picker = page.getByRole('combobox', { name: '歌词舞台' });
      const errors = [];
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const folder = path.join(output, 'focused-stage'); fs.mkdirSync(folder,{recursive:true});
      for (const pack of ['sonnet','tempera','lumiere','hanabi','pixel-bit']) {
        if (await page.locator('.lyric-options-panel').isHidden()) await trigger.click();
        await picker.selectOption(pack);
        await page.waitForFunction(pack => document.documentElement.dataset.lyricStage === pack && document.querySelector('.lyrics-reading')?.classList.contains('has-lyric-stage'), pack, {timeout:60000});
        const geometry = await page.locator('.tide-lyric-stage-host').evaluate(element => {
          const rect=element.getBoundingClientRect();
          const art=document.querySelector('.lyrics-art');
          const field=document.querySelector('.native-point-field');
          return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,innerWidth,innerHeight,art:getComputedStyle(art).display,field:field?getComputedStyle(field).visibility:'missing'};
        });
        assert(geometry.width >= geometry.innerWidth*.97 && geometry.height >= geometry.innerHeight*.90,JSON.stringify(geometry));
        assert.equal(geometry.art,'none'); assert(['hidden','missing'].includes(geometry.field));
        assert.equal(await page.locator('.tide-lyric-stage-host canvas').count(),1);
        await trigger.click();
        await page.screenshot({path:path.join(folder,`${pack}.png`)});
        await trigger.click();
      }
      await picker.selectOption('');
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-lyric-stage') && !document.querySelector('.tide-lyric-stage-host'));
      assert.notEqual(await page.locator('.lyrics-art').evaluate(element=>getComputedStyle(element).display),'none');
      assert.notEqual(await page.locator('.lyric-list').evaluate(element=>getComputedStyle(element).display),'none');
      assert.deepEqual(errors,[]);
      await page.screenshot({path:path.join(folder,'regular-restored.png')});
      console.log('FULLSCREEN_FIVE_STAGES_RESTORE_CSP_PASS');
      return;
    }
    const homeBounds = await page.locator('.home-grid').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
    });
    assert.ok(homeBounds.left >= -1 && homeBounds.top >= -1 && homeBounds.right <= homeBounds.width + 1 && homeBounds.bottom <= homeBounds.height + 1,
      `home grid must stay within the viewport: ${JSON.stringify(homeBounds)}`);
    homeBoundsChecks.push({ shell, mode, viewport: `${viewport.width}x${viewport.height}`, ...homeBounds });
    const folder = path.join(output, shell, mode, `${viewport.width}x${viewport.height}`);
    fs.mkdirSync(folder, { recursive: true });
    const take = async name => {
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(folder, `${name}.png`), animations: 'disabled' });
    };
    await take('home');
    const covers = await page.locator('.home-hero-art, .home-playlist-art').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(), parent = element.parentElement.getBoundingClientRect();
      return { width: rect.width, height: rect.height, clipped: rect.top < parent.top - 1 || rect.bottom > parent.bottom + 1 };
    }));
    assert.ok(covers.every(cover => cover.width >= 35 && Math.abs(cover.width - cover.height) < 2 && !cover.clipped), `home cover geometry: ${JSON.stringify(covers)}`);
    assert.equal(await page.locator('.home-inline-actions button, .home-hero-actions button, .home-lyrics, .home-footprint').count(), 0, 'duplicate cards and scattered action buttons should be removed');
    await page.waitForFunction(() => document.querySelector('.home-discover-title')?.textContent === '海面上的风');
    assert.ok(await page.locator('.home-discover-art img').getAttribute('src'), 'discovery uses the first recommendation artwork');
    await page.locator('.home-discover').click();
    await page.waitForFunction(() => document.querySelector('.playlist-hero h2')?.textContent === '今日潮汐' && !document.querySelector('.browse-sheet')?.hidden);
    await page.locator('.tide-nav-item[data-page="home"]').click();
    await page.locator('.home-proof').click();
    await page.waitForFunction(() => !document.querySelector('.proof-host')?.hidden);
    await page.locator('.tide-nav-item[data-page="home"]').click();
    await page.locator('.home-grid').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });

    const scrollMetrics = await page.locator('.home-grid').evaluate(element => ({ top: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    if (scrollMetrics.scrollHeight > scrollMetrics.clientHeight) {
      const logoSelector = shell === 'lens' ? '.liquid-metal-emblem' : '.native-point-hero';
      const beforeScroll = await page.locator('.home-grid').evaluate((element, selector) => {
        const slot = element.querySelector('.home-wordmark')?.getBoundingClientRect();
        const logo = document.querySelector(selector);
        return { slotTop: slot?.top ?? null, logoTop: logo ? parseFloat(logo.style.top) : null, logoPresent: Boolean(logo) };
      }, logoSelector);
      await page.locator('.home-grid').evaluate(element => { element.scrollTop = 180; element.dispatchEvent(new Event('scroll')); });
      await page.waitForTimeout(180);
      const afterScroll = await page.locator('.home-grid').evaluate((element, selector) => {
        const slot = element.querySelector('.home-wordmark')?.getBoundingClientRect();
        const logo = document.querySelector(selector);
        return { slotTop: slot?.top ?? null, logoTop: logo ? parseFloat(logo.style.top) : null, logoPresent: Boolean(logo) };
      }, logoSelector);
      assert.ok(afterScroll.slotTop < beforeScroll.slotTop, `home wordmark slot should move with scroll: ${JSON.stringify({ beforeScroll, afterScroll })}`);
      if (beforeScroll.logoPresent && afterScroll.logoPresent && Number.isFinite(beforeScroll.logoTop) && Number.isFinite(afterScroll.logoTop)) {
        const slotDelta = afterScroll.slotTop - beforeScroll.slotTop;
        const logoDelta = afterScroll.logoTop - beforeScroll.logoTop;
        assert.ok(Math.abs(logoDelta - slotDelta) <= 12, `floating ${shell} emblem should follow the wordmark slot: ${JSON.stringify({ slotDelta, logoDelta })}`);
      }
      scrollChecks.push({ shell, mode, viewport: `${viewport.width}x${viewport.height}`, scrollable: true, beforeScroll, afterScroll });
    } else {
      scrollChecks.push({ shell, mode, viewport: `${viewport.width}x${viewport.height}`, scrollable: false, metrics: scrollMetrics });
    }
    await take('home-scroll');
    await page.locator('.home-grid').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });

    const toggle = page.locator('.tide-nav-toggle');
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('.tide-nav')?.getAttribute('aria-expanded') === 'true' || document.querySelector('.tide-nav-toggle')?.getAttribute('aria-expanded') === 'true');
    const navLabels = await page.locator('.tide-nav-item').evaluateAll(items => items.map(item => ({ text: item.textContent.trim(), label: item.querySelector('.tide-nav-label')?.textContent.trim() })));
    assert.ok(navLabels.every(item => item.text === item.label), JSON.stringify(navLabels));
    await page.locator('.tide-nav-item[data-page="explore"]').focus();
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.page), 'footprint', 'End should move focus to the last primary navigation item');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.tide-nav-toggle')?.getAttribute('aria-expanded') === 'false');

    await page.locator('.peek-queue').hover();
    await page.waitForFunction(() => !document.querySelector('.queue-col')?.hidden);
    assert.equal(await page.locator('.corner-queue').isVisible(), false, 'queue icon stays hidden while the hover panel opens');
    await take('queue');
    await page.mouse.move(450, 620);
    await page.waitForFunction(() => document.querySelector('.queue-col')?.hidden);
    await page.mouse.move(450, 620);
    await page.locator('.peek-settings').hover({ position: { x: 50, y: 80 } });
    await page.locator('.corner-settings').waitFor({ state: 'visible' });
    await page.locator('.corner-settings').click();
    await page.waitForFunction(() => !document.querySelector('.settings-pop')?.hidden);
    await take('settings');
    await page.locator('.corner-settings').click();

    const navBeforeClick = await page.locator('.tide-nav-item').evaluateAll(items => items.map(item => {
      const rect = item.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { page: item.dataset.page, current: item.getAttribute('aria-current'), rect: [rect.x, rect.y, rect.width, rect.height], hit: top?.closest('.tide-nav-item')?.getAttribute('data-page') ?? top?.tagName ?? null };
    }));
    await page.evaluate(() => document.querySelector('.tide-nav')?.addEventListener('click', event => {
      window.__desktopSmokeNavClick = (event.target instanceof Element ? event.target.closest('.tide-nav-item')?.getAttribute('data-page') : null) ?? null;
    }, { capture: true }));
    await page.locator('.tide-nav-item[data-page="explore"]').click();
    await page.waitForTimeout(150);
    const exploreState = await page.evaluate(() => ({
      selected: document.querySelector('.tide-nav-item[aria-current="page"]')?.dataset.page ?? null,
      view: document.documentElement.dataset.view,
      page: document.documentElement.dataset.page,
      section: document.querySelector('.browse-sheet:not([hidden])')?.dataset.section ?? null,
      title: document.querySelector('.playlist-hero h2')?.textContent ?? null,
      clickTarget: window.__desktopSmokeNavClick ?? null,
    }));
    assert.equal(exploreState.selected, 'explore', `explore nav selection was lost: ${JSON.stringify({ ...exploreState, navBeforeClick, pageErrors })}`);
    assert.equal(exploreState.page, 'explore', `explore page selection was lost: ${JSON.stringify({ ...exploreState, navBeforeClick, pageErrors })}`);
    assert.equal(exploreState.section, 'playlist', `explore should show today's catalog: ${JSON.stringify({ ...exploreState, navBeforeClick, pageErrors })}`);
    assert.equal(exploreState.title, '今日潮汐');
    await page.waitForFunction(() => document.documentElement.dataset.page === 'explore' && document.querySelector('.browse-sheet:not([hidden])')?.dataset.section === 'playlist');
    await take('explore');

    await page.locator('.tide-nav-item[data-page="library"]').click();
    await page.waitForFunction(() => document.querySelector('.browse-sheet:not([hidden])')?.dataset.section === 'playlists');
    await take('library-playlists');
    await page.getByRole('tab', { name: '本地音乐' }).click();
    await page.waitForFunction(() => document.querySelector('.browse-sheet:not([hidden])')?.dataset.section === 'local');
    await take('library-local');

    await page.getByRole('searchbox', { name: '搜索' }).fill('海岸测试');
    await page.locator('form.search').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector('.search-page')?.hidden && document.querySelectorAll('.search-page .hit-row').length > 0);
    await take('search');

    await page.locator('.tide-nav-item[data-page="home"]').click();
    await page.evaluate(() => window.fixtureSetPlayback({ status: 'playing', index: 0, positionMs: 37500 }));
    await page.locator('.tide-nav-item[data-page="footprint"]').click();
    await page.waitForFunction(() => !document.querySelector('.session-footprint')?.hidden && document.querySelector('.session-history-item'));
    await take('footprint');

    await page.locator('.tide-nav-item[data-page="proof"]').click();
    await page.waitForFunction(() => !document.querySelector('.proof-host')?.hidden);
    await take('proof');

    await page.locator('.tide-nav-item[data-page="home"]').click();
    await page.locator('.home-hero').evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForFunction(() => document.documentElement.dataset.view === 'playing');
    await page.waitForTimeout(350);
    await take('playing');
    const nav = await page.locator('.tide-nav').evaluate(element => ({ expanded: element.dataset.expanded, labels: [...element.querySelectorAll('.tide-nav-label')].map(label => getComputedStyle(label).display) }));
    assert.equal(nav.expanded, 'false');
    assert.ok(nav.labels.every(value => value === 'none'), JSON.stringify(nav));
    if (shell === 'lattice') {
      await page.waitForFunction(() => document.querySelector('.lyrics-cover .cover-halftone')?.dataset.state === 'rendered', null, { timeout: 15000 });
      const ink = await page.locator('.lyrics-cover .cover-halftone').evaluate(canvas => {
        const context = canvas.getContext('2d');
        if (!context) return { pixels: 0, varied: false };
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let inkPixels = 0, minimum = 255, maximum = 0;
        for (let index = 3; index < data.length; index += 4) {
          if (data[index] > 0) inkPixels++;
          const light = data[index - 3];
          minimum = Math.min(minimum, light); maximum = Math.max(maximum, light);
        }
        return { inkPixels, varied: maximum > minimum };
      });
      assert.ok(ink.inkPixels > 20 && ink.varied, `halftone must vary with sampled cover luminance: ${JSON.stringify(ink)}`);
    } else assert.equal(await page.locator('.cover-halftone').count(), 0, 'Lens keeps the original artwork unprocessed');

    if (shell === 'lattice' && mode === 'light' && viewport.width === 900) {
      const crossOriginUrl = `http://127.0.0.1:${noCorsCoverPort}/cover.svg`;
      await page.locator('.lyrics-cover img').evaluate((image, url) => { image.src = url; }, crossOriginUrl);
      await page.waitForFunction(url => {
        const image = document.querySelector('.lyrics-cover img');
        return image?.src === url && image.complete && image.naturalWidth > 0;
      }, crossOriginUrl, { timeout: 10000 });
      await page.waitForFunction(() => !document.querySelector('.lyrics-cover .cover-halftone'), null, { timeout: 10000 });
      assert.equal(await page.locator('.lyrics-cover img').getAttribute('src'), crossOriginUrl, 'CORS sampling failure must preserve the original artwork');
      await take('cover-cors-fallback');
      coverCorsFallbackChecked = true;
    }

    const stageTrigger = page.locator('.lyric-options-trigger');
    const stageSelect = page.getByRole('combobox', { name: '歌词舞台' });
    await stageTrigger.click();
    await page.evaluate(() => {
      window.__desktopSmokeStageFrames = [];
      window.__desktopSmokeStageErrors = [];
      window.addEventListener('tide:lyric-stage-frame', event => {
        window.__desktopSmokeStageFrames.push({ positionMs: event.detail?.positionMs, pack: event.detail?.pack });
      });
      window.addEventListener('tide:lyric-stage-error', event => {
        window.__desktopSmokeStageErrors.push(event.detail?.message ?? String(event.detail));
      });
    });
    assert.deepEqual(await stageSelect.locator('option').evaluateAll(options => options.map(option => [option.value, option.textContent])), [['', '常规'], ['sonnet', '商籁'], ['tempera', '凝彩'], ['lumiere', '绘光'], ['hanabi', '花火'], ['pixel-bit', '像素信号']]);
    assert.equal(await page.locator('script[data-tide-lyric-stage-engine]').count(), 0, 'stage engine must remain unloaded until a style is selected');
    if (!stageFallbackChecked) {
      await page.route('**/lyric-stage-engine.js', route => route.abort('failed'));
      await stageSelect.selectOption('sonnet');
      await page.waitForFunction(() => {
        const picker = document.querySelector('.lyric-stage-picker select');
        return document.querySelector('.lyrics-reading')?.classList.contains('has-lyric-stage') || (picker?.value === '' && !document.querySelector('.lyric-stage-status')?.hidden);
      }, null, { timeout: 45000 });
      await page.unroute('**/lyric-stage-engine.js');
      assert.equal(await stageSelect.inputValue(), '', 'failed engine load should restore the regular style');
      assert.ok(await page.locator('.lyric-stage-status').isVisible(), 'stage failure should be announced');
      assert.notEqual(await page.locator('.lyric-list').evaluate(element => getComputedStyle(element).display), 'none', 'regular lyrics should remain readable after stage failure');
      await take('lyric-stage-fallback');
      stageFallbackChecked = true;
      await stageSelect.selectOption('sonnet');
    } else {
      await stageSelect.selectOption('sonnet');
    }
    await page.waitForFunction(() => {
      const picker = document.querySelector('.lyric-stage-picker select');
      return document.querySelector('.lyrics-reading')?.classList.contains('has-lyric-stage') || (picker?.value === '' && !document.querySelector('.lyric-stage-status')?.hidden);
    }, null, { timeout: 60000 });
    let stageOutcome = 'fallback';
    if (await page.locator('.lyrics-reading').evaluate(element => element.classList.contains('has-lyric-stage'))) {
      stageOutcome = 'canvas';
      assert.equal(await page.locator('script[data-tide-lyric-stage-engine]').count(), 1, 'stage bundle should load once after selection');
      assert.equal(await page.locator('.lyric-list').evaluate(element => getComputedStyle(element).display), 'none', 'the stage replaces the duplicate lyric list');
      await page.waitForFunction(() => window.__desktopSmokeStageFrames.length > 0);
      await page.getByRole('button', { name: '翻译', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.lyric-tools button[aria-pressed="true"]')?.textContent === '翻译');
      assert.ok(await page.locator('.lyrics-reading').evaluate(element => element.classList.contains('has-lyric-stage')), 'translation view should keep the selected stage active');
      await stageTrigger.click();
      await page.getByRole('button', { name: '罗马音', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.lyrics-reading')?.classList.contains('has-lyric-stage') && document.querySelector('.lyrics-line')?.textContent === '这首没有罗马音');
      await stageTrigger.click();
      await page.getByRole('button', { name: '双语', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.lyrics-reading')?.classList.contains('has-lyric-stage'));
      await stageTrigger.click();
      await page.waitForFunction(() => window.__desktopSmokeStageFrames.length > 0);
      const frameBeforeOffset = await page.evaluate(() => window.__desktopSmokeStageFrames.at(-1)?.positionMs ?? null);
      assert.equal(frameBeforeOffset, 37500, `stage should use the current Tide playback position, got ${frameBeforeOffset}`);
      await page.getByRole('button', { name: '+0.5s', exact: true }).click();
      await page.waitForFunction(before => window.__desktopSmokeStageFrames.some(frame => frame.positionMs === before + 500), frameBeforeOffset);
      await page.getByRole('button', { name: '−0.5s', exact: true }).click();
      await page.waitForFunction(before => window.__desktopSmokeStageFrames.some(frame => frame.positionMs === before), frameBeforeOffset);
      await stageSelect.selectOption('hanabi');
      await page.waitForFunction(() => document.querySelector('.tide-lyric-stage-host')?.dataset.pack === 'hanabi');
      await page.waitForTimeout(1200);
      if (!(await page.locator('.lyrics-reading').evaluate(element => element.classList.contains('has-lyric-stage')))) stageOutcome = 'fallback-after-switch';
      else assert.equal(await page.locator('.tide-lyric-stage-host').getAttribute('data-pack'), 'hanabi');
      const optionsPanel = page.locator('.lyric-options-panel');
      if (await optionsPanel.isVisible()) await stageTrigger.click();
      await take('lyric-stage');
      if (await optionsPanel.isHidden()) await stageTrigger.click();
      if (shell === 'lens' && mode === 'dark' && viewport.width === 1600) {
        await stageTrigger.click();
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.evaluate(() => window.tide.setAppearance({ motion: 1, performance: 'balanced', lensMode: 'light' }));
        await page.waitForFunction(() => Number(document.querySelector('.theme-reveal-frame')?.dataset.radius) > 80);
        const preview = page.frameLocator('.theme-reveal-frame');
        await preview.locator('.tide-lyric-stage-host img, .tide-lyric-stage-preview').first().waitFor({ state: 'visible' });
        await page.evaluate(() => window.fixtureSetPlayback({ positionMs: 38500 }));
        await preview.locator('.tide-lyric-stage-preview').waitFor({ state: 'visible' });
        const previewPixels = await preview.locator('.tide-lyric-stage-preview').evaluate(canvas => {
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          return pixels.some((value, index) => index % 4 === 3 && value > 8);
        });
        assert.equal(previewPixels, true, 'animated theme reveal must carry current stage pixels');
        await take('lyric-stage-reveal');
        await page.waitForFunction(() => !document.querySelector('.theme-reveal-frame'), null, { timeout: 10000 });
        assert.equal(await page.locator('.tide-lyric-stage-host canvas').count(), 1, 'reveal must retain only one live stage renderer');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(() => window.tide.setAppearance({ motion: 0, performance: 'smooth', lensMode: 'dark' }));
        await stageTrigger.click();
      }
      await stageSelect.selectOption('');
      await page.waitForFunction(() => !document.querySelector('.tide-lyric-stage-host') && document.querySelector('.lyric-stage-picker select')?.value === '');
      assert.notEqual(await page.locator('.lyric-list').evaluate(element => getComputedStyle(element).display), 'none', 'switching to regular lyrics should restore the list');
    } else {
      assert.equal(await stageSelect.inputValue(), '', 'stage failure should reset the selector');
      assert.notEqual(await page.locator('.lyric-list').evaluate(element => getComputedStyle(element).display), 'none');
      await take('lyric-stage');
    }
    stageChecks.push({ shell, mode, viewport: `${viewport.width}x${viewport.height}`, outcome: stageOutcome, errors: await page.evaluate(() => window.__desktopSmokeStageErrors) });
  };

  for (const [shell, modes] of [['lens', ['light', 'dark']], ['lattice', ['light', 'dark']]]) {
    for (const mode of modes) {
      for (const viewport of [{ width: 900, height: 650 }, { width: 1600, height: 1000 }]) { if (process.env.TIDE_STAGE_FOCUSED === '1' && !(shell === 'lens' && mode === 'light' && viewport.width === 1600)) continue; await capture(shell, mode, viewport); }
    }
  }
  assert.deepEqual(pageErrors, [], `renderer page errors: ${JSON.stringify(pageErrors)}`);
  fs.writeFileSync(path.join(output, 'screenshots.json'), JSON.stringify({ pages, shells: ['lens', 'lattice'], modes: ['light', 'dark'], viewports: [{ width: 900, height: 650 }, { width: 1600, height: 1000 }], syntheticDataOnly: true, homeBoundsChecks, scrollChecks, stageFallbackChecked, stageChecks, coverCorsFallbackChecked }, null, 2));
  await browser.close();
  server.close();
  noCorsCoverServer.close();
  console.log(`DESKTOP_REDESIGN_SCREENSHOTS_PASS ${output}`);
})().catch(async error => {
  console.error(error);
  await browser?.close();
  server.close();
  noCorsCoverServer.close();
  process.exitCode = 1;
});
