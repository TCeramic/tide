// Main playback implementation + real loopback HTTP, with only Electron IPC replaced.
const { build } = require('esbuild');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const handlers = new Map();
global.__tideTestIpc = { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name), on() {}, removeListener() {} };
const hit = id => ({ id: String(id), title: 'Song ' + id, artist: 'Artist ' + (id % 7), albumTitle: 'Album', cover:'https://example.com/cover.jpg', albumId: '42', durationMs: 1000, playable: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await delay(20); } assert.fail('timed out'); }
(async () => {
  const file = path.join(root, 'artifacts/playback-host-fixture.cjs'); fs.mkdirSync(path.dirname(file), { recursive: true });
  await build({ entryPoints: [path.join(root, 'src/main/playback-host.ts')], outfile: file, bundle: true, platform: 'node', format: 'cjs', plugins: [{ name: 'fixture-ipc', setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const ipcMain = globalThis.__tideTestIpc; export const BrowserWindow = {getAllWindows:()=>[]};', loader: 'js' }));
  }}] });
  // Machine is exported in a separate fixture to share the exact implementation.
  const machineFile = path.join(root, 'artifacts/playback-machine-fixture.cjs');
  await build({ entryPoints: [path.join(root, 'src/core/playback/machine.ts')], outfile: machineFile, bundle: true, platform: 'node', format: 'cjs' });
  const { attachPlayback } = require(file), { PlaybackMachine } = require(machineFile);
  const calls = [], seeds = []; let releasePage = null, delayed = false;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'); calls.push(req.url);
    let body = { ok: true };
    if (url.pathname === '/song/url') body = { ok: true, url: 'http://127.0.0.1/song.mp3' };
    if (url.pathname === '/session') body = {ok:true,state:'logged_in',user:{id:'1',nickname:'QA'},playlists:[{id:'7',name:'我喜欢的音乐',specialType:5}]};
    if (url.pathname === '/recommend/daily') body = {ok:true,hits:Array.from({length:100},(_,i)=>hit(20000+i))};
    if (url.pathname === '/liked') body = { ok: true, known: true, ids: ['1'] };
    if (url.pathname === '/similar') { const id = url.searchParams.get('id'); seeds.push(id); body = { ok: true, hits: [hit(9000 + Number(id))] }; }
    if (url.pathname === '/playlist/tracks') {
      if (delayed) await new Promise(r => { releasePage = r; });
      body = { ok: true, hits: Array.from({ length: 50 }, (_, i) => hit(101 + i)), source: { playlistId: '7', offset: 150, hasMore: false } };
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const machine = new PlaybackMachine();
  const { control, detach } = attachPlayback(() => null, machine, () => server.address().port);
  try {
    const source = { playlistId: '7', offset: 100, hasMore: true };
    await control.playHits(Array.from({ length: 100 }, (_, i) => ({ ...hit(i + 1), liked: i === 1 })), 80, source);
    await delay(80); assert.equal(calls.some(c => c.startsWith('/playlist/tracks')), false);
    await control.track(89); await until(() => control.get().queue.length === 150);
    assert.equal(calls.filter(c => c.startsWith('/playlist/tracks')).length, 1);
    assert.equal(control.get().queue[149].albumTitle, 'Album');
    control.setMode({ explore: true, repeat: 'off', shuffle: false });
    await delay(100); assert.equal(control.get().queue.length, 150, 'no insertion in the middle');
    await control.track(149); await until(() => control.get().queue.length === 151);
    const firstRandom = control.get().queue[150].id;
    const beforeLoop=control.get();control.setMode({repeat:'all',explore:false});const afterLoop=control.get();
    assert.deepEqual(afterLoop.queue[afterLoop.index],beforeLoop.queue[beforeLoop.index],'clearing an inspiration tail keeps the current cover and album');
    assert.equal(afterLoop.queue.length,150);control.setMode({repeat:'off',explore:true});await until(()=>control.get().queue.length===151);

    assert.ok(Number(firstRandom) >= 9000);
    await control.track(0); await delay(100);
    assert.equal(control.get().queue.length, 151, 'changing tracks never inserts another recommendation');
    assert.equal(control.get().queue[1].id, '2', 'original playlist order is preserved');
    await control.playHits(Array.from({length:150}, (_,i)=>hit(i+1)), 149);
    await until(() => control.get().queue.length === 151);
    assert.notEqual(control.get().queue[150].id, firstRandom, 'reopening a playlist resamples');
    const nextSong = control.get().queue[150].id;
    await control.next(); assert.equal(control.get().queue[control.get().index].id, nextSong);
    await until(() => control.get().queue.length === 152);
    assert.ok(seeds.includes('1') && seeds.some(id => Number(id) > 100) && seeds.some(id => Number(id) > 40 && Number(id) < 100));
    console.log('PLAYLIST_PREFETCH_AND_RANDOM_TAIL_ONLY_WITH_FULL_PROFILE passed');
    const today = await handlers.get('tide:today')({}, false);
    const refreshed = await handlers.get('tide:today')({}, true);
    assert.equal(today.hits.length,20); assert.equal(refreshed.hits.length,20);
    assert.ok(refreshed.hits.every(h=>!today.hits.some(old=>old.id===h.id)));
    const requestsBeforeReentry=calls.length;
    const reopened=await handlers.get('tide:today')({},false);
    assert.deepEqual(reopened.hits,refreshed.hits,'reopening keeps the refreshed snapshot');
    assert.equal(calls.length,requestsBeforeReentry,'reopening must not regenerate the old daily list');
    control.setMode({explore:false}); control.seek(500);
    const currentBefore=control.get().queue[control.get().index].id;
    const replaced=await handlers.get('tide:replace-upcoming')({},refreshed.hits);
    assert.equal(replaced.queue[replaced.index].id,currentBefore); assert.equal(replaced.positionMs,500);
    assert.equal(replaced.queue[replaced.index+1].id,refreshed.hits[0].id);
    console.log('TODAY_REAL_HOST_REFRESH_20_AND_REPLACE_PRESERVES_CURRENT passed');
    delayed = true;
    await control.playHits(Array.from({ length: 100 }, (_, i) => hit(i + 1)), 99, source);
    await until(() => releasePage !== null);
    control.setMode({ explore: false });
    await control.playHits([hit(999)], 0);
    releasePage(); await delay(100);
    assert.deepEqual(control.get().queue.map(t => t.id), ['999']);
    console.log('STALE_PLAYLIST_REQUEST_CANNOT_MODIFY_NEW_QUEUE passed');
  } finally { detach(); await new Promise(r => server.close(r)); delete global.__tideTestIpc; }
})().catch(error => { console.error(error); process.exitCode = 1; });
