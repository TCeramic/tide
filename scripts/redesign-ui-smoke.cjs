// Actual renderer + a deterministic IPC fixture; no live account or audio claims.
const { chromium } = require(process.env.TIDE_PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'../dist');
const output = path.resolve(process.env.TIDE_UI_OUTPUT || path.join(__dirname,'../artifacts/ui-smoke'));
fs.mkdirSync(output,{recursive:true});
const mime = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json'};
let browser;
const server = http.createServer((req,res)=>{if(req.url==='/fixture.wav'){const wav=Buffer.alloc(44+32000*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);res.setHeader('Content-Type','audio/wav');res.end(wav);return;}if(req.url==='/fixture-cover.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#d5ee7a"/><circle cx="48" cy="48" r="24" fill="#182018"/></svg>');return;}const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(b);});});
(async()=>{
 await new Promise(r=>server.listen(4179,'127.0.0.1',r));
 browser=await chromium.launch({channel:process.env.TIDE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  if(window.top !== window) return;
  localStorage.setItem('tide.risk.ack','1');
  const listeners={};
  const appearance={chromeVisible:true,stageLevel:1,theme:'tide',motion:1,lattice:false,shell:'lens',preset:'tide',performance:'balanced',background:'solid',fontPreset:'system',fontFamily:''};
  const snapshot={status:'idle',queue:[],index:-1,positionMs:0,volume:.8,error:null,repeat:'all',shuffle:false,explore:false};
  const desk={open:false,locked:false,x:null,y:null,fontSize:48,color:'#f7fbfc',opacity:1,highlightFollow:true,motion:true,glow:.72,pair:false,wave:false,orientation:'horizontal',motionLevel:1,backdrop:0};
  const data={getPlayback:snapshot,getHealth:{ok:true,service:'tide',version:'0.9.1',busPort:39272},getSession:{ok:true,state:'logged_in',user:{nickname:'QA'},playlists:[{id:'9',name:'远端歌单',trackCount:20,cover:'http://127.0.0.1:4179/fixture-cover.svg'}]},getMediaShortcuts:{shortcuts:{},messages:[],captureMediaKeys:true},getQuality:'standard',getDeskLyrics:desk,localTracks:[],likedIds:{ok:true,known:false,ids:[]},backdropUrl:null,fontFace:null,getAppearance:appearance};
  const cover='http://127.0.0.1:4179/fixture-cover.svg';
  const tracks=[{id:'1',title:'长歌曲标题用于检查边框'.repeat(8),artist:'歌手名字'.repeat(6),albumTitle:'测试专辑',albumId:'30',durationMs:232000,playable:true,cover}];
  snapshot.queue=tracks; snapshot.index=0;
  window.fixtureMedia=cue=>listeners.onMedia?.forEach(f=>f(cue)); window.fixtureCover=cover; window.fixtureAdds=0;
  const yrc=Array.from({length:12},(_,i)=>{const text=`测试歌词第${i+1}行 让文字跟随音乐`;return {timeMs:i*5000,durationMs:4500,text,words:Array.from(text).map((text,j)=>({text,timeMs:i*5000+j*180,durationMs:180}))};});
  data.aiStatus={configured:false,provider:'openai-compatible',model:''};
  data.lyric={ok:true,trackId:'1',lines:yrc.map(row=>({timeMs:row.timeMs,text:row.text})),translation:yrc.map(row=>({timeMs:row.timeMs,text:'Translation '+row.text})),romaji:[],yrc,source:'amll',credits:['QA fixture']};
  window.fixtureClose=()=>listeners.onCloseRequest?.forEach(f=>f()); window.fixtureActions=[];
  window.fixtureSetPlayback=patch=>{Object.assign(snapshot,patch);listeners.onPlayback?.forEach(f=>f({...snapshot}));};

  window.fixtureLists=[];window.fixtureSearchCalls=[];window.fixtureTodayGeneration=0; window.fixtureReplaced=0;
  window.tide=new Proxy({mediaKeys:{},
    tidePlaylists:async()=>window.fixtureLists,
    dailyRecommend:async()=>({ok:true,kind:'songs',hits:tracks}),
    playlistTracks:async()=>({ok:true,kind:'songs',hits:Array.from({length:20},(_,i)=>({...tracks[0],id:String(i+1)}))}),
    playHits:async(rows,index)=>{window.fixturePlayIndex=index;window.fixtureSetPlayback({queue:rows,index,status:'playing'});return snapshot;},
    saveTidePlaylist:async(id,patch)=>{const old=window.fixtureLists.find(p=>p.id===id),row={...old,...patch,id:id??'tide-list-test',songs:old?.songs??[],updatedAt:Date.now()};window.fixtureLists=old?window.fixtureLists.map(p=>p.id===id?row:p):[...window.fixtureLists,row];return {ok:true,playlist:row};},

    tideToday:async refresh=>{if(refresh)window.fixtureTodayGeneration++;window.fixtureTodayRows=Array.from({length:20},(_,i)=>({...tracks[0],id:String(500+window.fixtureTodayGeneration*20+i),title:`潮汐 ${window.fixtureTodayGeneration}-${i+1}`}));return {ok:true,hits:window.fixtureTodayRows,message:null};},
    replaceUpcoming:async rows=>{window.fixtureReplaced++;const current=snapshot.queue[snapshot.index];snapshot.queue=[current,...rows.filter(h=>h.id!==current.id)];snapshot.index=0;listeners.onPlayback?.forEach(f=>f({...snapshot}));return {...snapshot};},
    windowAction:async action=>window.fixtureActions.push(action),
    search:async(keywords,type,offset=0)=>{window.fixtureSearchCalls.push({keywords,type,offset});return keywords==="分页测试"&&type===1?{ok:true,kind:"songs",hits:Array.from({length:offset===0?20:offset===20?20:3},(_,i)=>({...tracks[0],id:String(offset+i+1),title:`分页歌曲 ${offset+i+1}`})),nextOffset:offset+20,hasMore:offset<40}:type===10?{ok:true,kind:'albums',albums:[{id:'2',name:'专辑名称'.repeat(12),artist:'测试歌手',cover}]}:{ok:true,kind:'songs',hits:keywords==='保留状态'?Array.from({length:30},(_,i)=>({...tracks[0],id:String(i+1),title:`保留曲目 ${i+1}`})):tracks};},
    albumTracks:async()=>({ok:true,kind:'songs',hits:tracks}),
    addLocalTracks:async()=>{window.fixtureAdds++;data.localTracks=tracks;return tracks;},
setAppearance:async patch=>{Object.assign(appearance,patch);for(const f of listeners.onAppearance??[])await f({...appearance});return {...appearance};}}, {get(target,key){if(key in target)return target[key];if(String(key).startsWith('on'))return f=>{(listeners[key]||=[]).push(f);return ()=>{};};return async()=>data[key]??{ok:false,message:'preview fixture'};}});
 });

 await page.goto('http://127.0.0.1:4179/');await page.waitForTimeout(1800);
 assert.equal(await page.locator('.home-card').count(),5);assert.equal(await page.locator('.preset-card').count(),0);
 await page.evaluate(()=>window.tide.setAppearance({shell:'lattice',background:'paper',performance:'balanced'}));await page.waitForTimeout(1000);
 const home=await page.locator('.home-card').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));assert.ok(home[0].x<home[1].x&&home[0].h>home[1].h);
 await page.screenshot({path:path.join(output,'home-redesign.png')});
 await page.locator('.home-card').filter({has:page.locator('h2',{hasText:'歌单'})}).click();await page.waitForFunction(()=>document.querySelectorAll('.playlist-card').length===3);
 const squares=await page.locator('.playlist-art').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {w:r.width,h:r.height};}));for(const r of squares)assert.ok(Math.abs(r.w-r.h)<2,JSON.stringify(r));
 await page.screenshot({path:path.join(output,'playlist-grid.png')});
 await page.getByRole('button',{name:'打开歌单 远端歌单',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.hits .hit-row').length===20);
 assert.equal(await page.locator('.playlists').isVisible(),false);await page.evaluate(()=>document.querySelector('.hit').click());await page.getByRole('button',{name:'开始播放',exact:true}).click();assert.equal(await page.evaluate(()=>window.fixturePlayIndex),0);
 await page.evaluate(()=>window.fixtureSetPlayback({shuffle:true}));await page.getByRole('button',{name:'开始播放',exact:true}).click();assert.ok((await page.evaluate(()=>window.fixturePlayIndex))>=0);
 await page.getByRole('button',{name:'主页',exact:true}).click();await page.locator('.home-card').filter({has:page.locator('h2',{hasText:'本地音乐'})}).click();assert.equal(await page.locator('.playlists').isVisible(),false);assert.equal(await page.locator('.local-actions').isVisible(),true);
 await page.getByRole('button',{name:'主页',exact:true}).click();await page.locator('.home-card').filter({has:page.locator('h2',{hasText:'歌单'})}).click();await page.getByRole('button',{name:'打开歌单 每日推荐',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.playlist-hero h2')?.textContent==='每日推荐');assert.equal(await page.locator('.playlists').isVisible(),false);
 await page.getByRole('button',{name:'主页',exact:true}).click();await page.getByRole('searchbox',{name:'搜索',exact:true}).fill('分页测试');await page.getByRole('button',{name:'单曲',exact:true}).click();await page.locator('form.search').evaluate(el=>el.requestSubmit());await page.waitForFunction(()=>document.querySelectorAll('.search-page .hit-row').length===20);await page.getByRole('button',{name:'加载更多',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.search-page .hit-row').length===40);
 await page.getByRole('searchbox',{name:'搜索',exact:true}).focus();await page.getByRole('button',{name:'专辑',exact:true}).click();await page.waitForSelector('.search-page .catalog-entry');assert.equal(await page.evaluate(()=>window.fixtureSearchCalls.at(-1).type),10);
 await page.getByRole('button',{name:'主页',exact:true}).click();await page.mouse.move(720,958);await page.waitForFunction(()=>document.documentElement.dataset.dockVisible==='true');await page.waitForTimeout(650);assert.ok((await page.locator('.dock-shell').boundingBox()).y<960);
 await page.mouse.move(700,400);await page.waitForFunction(()=>document.documentElement.dataset.dockVisible==='false');await page.waitForTimeout(600);assert.ok((await page.locator('.dock-shell').boundingBox()).y>950);
 await page.mouse.move(720,958);await page.waitForFunction(()=>document.documentElement.dataset.dockVisible==='true');await page.locator('.dock-cover').click();await page.waitForTimeout(500);assert.equal(await page.locator('html').getAttribute('data-view'),'playing');assert.equal(await page.locator('#lyrics .ai-assist').count(),0);assert.equal(await page.locator('.topbar').evaluate(el=>getComputedStyle(el).opacity),'0');
 assert.equal(await page.locator('.lyrics-art').evaluate(el=>getComputedStyle(el).scrollbarWidth),'none');
 await page.locator('.lyrics-reading').hover();await page.getByRole('button',{name:'歌词选项',exact:true}).click();assert.equal(await page.getByRole('button',{name:'双语',exact:true}).isVisible(),true);
 await page.getByRole('button',{name:'搜索当前歌手',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.view==='home');assert.equal(await page.evaluate(()=>window.fixtureSearchCalls.at(-1).type),100);
 await page.getByRole('button',{name:'主页',exact:true}).click();
 await page.evaluate(()=>window.fixtureSetPlayback({queue:Array.from({length:20},(_,i)=>({id:String(1000+i),title:'树歌曲 '+i,artist:'树歌手 '+i,artistId:String(2000+i),albumTitle:'树专辑 '+i,albumId:String(3000+i),durationMs:200000,playable:true})),index:0}));
 await page.locator('.home-card').filter({has:page.locator('h2',{hasText:'音乐脉络'})}).click();await page.waitForFunction(()=>document.querySelector('.proof-canvas')?.dataset.nodes>1);await page.waitForTimeout(1500);
 const canvas=page.locator('.proof-canvas'),treeRoot=await canvas.getAttribute('data-root');await page.getByRole('button',{name:'下一组',exact:true}).click();const pageText=await page.locator('.proof-pager').innerText();await page.locator('.proof-node').first().click();await page.waitForTimeout(700);assert.equal(await canvas.getAttribute('data-root'),treeRoot);
 const positions=await page.locator('.proof-label').evaluateAll(els=>els.map(el=>el.style.transform));await page.waitForTimeout(1000);assert.notDeepEqual(await page.locator('.proof-label').evaluateAll(els=>els.map(el=>el.style.transform)),positions);
 await page.getByRole('button',{name:'返回上一级',exact:true}).click();await page.waitForTimeout(600);assert.equal(await page.locator('.proof-pager').innerText(),pageText);await page.screenshot({path:path.join(output,'music-lineage-3d.png')});
 await page.getByRole('button',{name:'← 返回主页',exact:true}).click();await page.locator('.home-card').filter({has:page.locator('h2',{hasText:'歌单'})}).click();await page.getByRole('button',{name:'创建歌单',exact:true}).click();await page.getByRole('textbox',{name:'歌单名称',exact:true}).fill('Tide内置歌单');await page.getByRole('textbox',{name:'歌单描述',exact:true}).fill('保留这段描述');await page.getByRole('button',{name:'保存歌单',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.playlist-hero h2')?.textContent==='Tide内置歌单');assert.equal(await page.locator('.playlist-description').innerText(),'保留这段描述');await page.getByRole('button',{name:'编辑歌单',exact:true}).click();await page.getByRole('textbox',{name:'歌单名称',exact:true}).fill('已编辑歌单');await page.getByRole('button',{name:'保存歌单',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.playlist-hero h2')?.textContent==='已编辑歌单');
 assert.deepEqual(errors,[]);console.log('REDESIGNED_HOME_SQUARE_COVERS_ROUTES_PAGINATION_LIVE_FILTER_DOCK_LYRICS passed');await browser.close();server.close();
})().catch(async e=>{console.error(e);process.exitCode=1;await browser?.close();server.close();});
