// Short isolated Electron soak; no accounts, playback backend or installed Tide profile.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts', 'lyric-stage-soak');
const packs = ['sonnet', 'tempera', 'lumiere', 'hanabi'];
app.setPath('userData', path.join(out, 'isolated-electron-profile'));
app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('js-flags', '--expose-gc');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let window;
async function main() {
  await app.whenReady();
  await fs.mkdir(out, { recursive: true });
  await build({ stdin: { contents: 'import { mountLyricStage } from "./src/renderer/lyric-stage"; window.mountTestStage = mountLyricStage;', resolveDir: root }, bundle: true, outfile: path.join(out, 'adapter.js'), platform: 'browser', format: 'iife', target: 'es2022' });
  const engine = new URL(`file:///${path.join(root, 'dist', 'lyric-stage-engine.js').replaceAll('\\', '/')}`).href;
  await fs.writeFile(path.join(out, 'fixture.html'), `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self' file:; script-src 'self' file:; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: blob:; connect-src 'none'"><style>html,body{margin:0;background:#111923;color:#eee}#stage{position:relative;width:800px;height:500px}</style></head><body><div id="stage"></div><script src="${engine}"></script><script src="./adapter.js"></script></body></html>`);
  window = new BrowserWindow({ show: false, width: 800, height: 500, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
  const errors = [];
  window.webContents.on('console-message', (event, legacyLevel, legacyMessage) => { const level=event.level ?? legacyLevel; const message=event.message ?? legacyMessage; console.log('RENDERER',level,String(message).slice(0,180)); if(level===3 || level==='error')errors.push(message); });
  await window.loadFile(path.join(out, 'fixture.html'));
  console.log('FIXTURE',await window.webContents.executeJavaScript('JSON.stringify({engine:typeof window.TideLumiStageEngine,mount:typeof window.mountTestStage,scripts:Array.from(document.scripts).map(s=>s.src)})')); 
  console.log(await window.webContents.executeJavaScript(`(() => {
    try { window.audit = {created:0,destroyed:0,active:0,maxActive:0,frames:[],contextCreated:0,contextLost:0};
    const originalContext=HTMLCanvasElement.prototype.getContext;
    const contexts=new WeakSet();
    HTMLCanvasElement.prototype.getContext=function(...args){const context=originalContext.apply(this,args);if(context && /webgl/.test(args[0]) && !contexts.has(context)){contexts.add(context);audit.contextCreated++;this.addEventListener('webglcontextlost',()=>audit.contextLost++);}return context;};
    const create=TideLumiStageEngine.LumiKernel.create.bind(TideLumiStageEngine.LumiKernel);
    TideLumiStageEngine.LumiKernel.create=async (...args)=>{const kernel=await create(...args);audit.created++;audit.active++;audit.maxActive=Math.max(audit.maxActive,audit.active);const destroy=kernel.destroy.bind(kernel);let done=false;kernel.destroy=()=>{if(!done){done=true;audit.active--;audit.destroyed++;}return destroy();};return kernel;};
    addEventListener('tide:lyric-stage-frame',e=>audit.frames.push({pack:e.detail.pack,position:e.detail.positionMs,at:performance.now()}));
    const original=Array.from({length:24},(_,i)=>({timeMs:i*4000,text:'Silver tide carries every sound '+i}));
    const empty=[];
    window.testState={trackId:'soak-fixture',pack:null,yrc:empty,original,translation:empty,romanization:empty,durationMs:96000,positionMs:0,playing:false,metadata:{title:'Isolated short soak',artist:'Fixture'},theme:{backgroundColor:'#111923',primaryColor:'#f5f2ed',accentColor:'#83ddf1',secondaryColor:'#a8b8c8',fontStyle:'sans'},coverBlob:null,coverColors:['#83ddf1','#d8a9ca'],performance:'balanced'};
    window.handle=mountTestStage(document.querySelector('#stage'),testState,e=>{throw e});
    window.pushState=patch=>{testState={...testState,...patch};handle.update(testState);};
    window.sample=()=>({created:audit.created,destroyed:audit.destroyed,active:audit.active,maxActive:audit.maxActive,canvases:document.querySelectorAll('#stage canvas').length,frames:audit.frames.length,last:audit.frames.at(-1),contextCreated:audit.contextCreated,contextLost:audit.contextLost,heap:performance.memory?.usedJSHeapSize??null}); return 'initialized'; } catch(e) { return String(e.stack); }
  })()`));
  const report = { label:'Short isolated soak, not evidence of long-term stability', rounds:3, startedAt:new Date().toISOString(), runs:[], memory:[], consoleErrors:errors };
  const started = Date.now();
  for (let round=0;round<3;round++) for (const pack of packs) {
    await window.webContents.executeJavaScript(`pushState({pack:${JSON.stringify(pack)},positionMs:12500,playing:false})`);
    const readyStart=Date.now();
    while (!(await window.webContents.executeJavaScript('sample().active===1 && sample().last?.pack===testState.pack'))) {if(Date.now()-readyStart>30000)throw Error('stage creation timeout '+pack);await sleep(50);}
    const before=await window.webContents.executeJavaScript('sample()');
    assert.equal(before.canvases,1);
    await window.webContents.executeJavaScript(`(async()=>{const start=performance.now();while(performance.now()-start<2000){pushState({positionMs:12500+performance.now()-start,playing:true});await new Promise(requestAnimationFrame);}pushState({playing:false});})()`);
    const pauseBefore=await window.webContents.executeJavaScript('sample()');
    await window.webContents.executeJavaScript(`(async()=>{for(let i=0;i<50;i++){pushState({playing:false});await new Promise(r=>setTimeout(r,20));}})()`);
    const pauseAfter=await window.webContents.executeJavaScript('sample()');
    assert.equal(pauseAfter.frames,pauseBefore.frames,pack+' paused redraws');
    await window.webContents.executeJavaScript('handle.setVisible(false)');
    const hiddenBefore=await window.webContents.executeJavaScript('sample()');
    await window.webContents.executeJavaScript(`(async()=>{for(let i=0;i<50;i++){pushState({positionMs:25000+i*20,playing:true});await new Promise(r=>setTimeout(r,20));}})()`);
    const hiddenAfter=await window.webContents.executeJavaScript('sample()');
    assert.equal(hiddenAfter.frames,hiddenBefore.frames,pack+' hidden drew frames');assert.equal(hiddenAfter.active,0);assert.equal(hiddenAfter.canvases,0);
    await window.webContents.executeJavaScript('handle.setVisible(true)');
    const restoreStart=Date.now();
    while (!(await window.webContents.executeJavaScript('sample().active===1 && sample().last?.position===testState.positionMs'))) {if(Date.now()-restoreStart>30000)throw Error('restore timeout '+pack);await sleep(50);}
    await sleep(500);
    const restored=await window.webContents.executeJavaScript('sample()');
    assert.equal(restored.last.position,25980);assert.equal(restored.canvases,1);
    if(round===0)await fs.writeFile(path.join(out,pack+'.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript('pushState({pack:null,playing:false})');await sleep(500);
    const regular=await window.webContents.executeJavaScript('sample()');assert.equal(regular.active,0);assert.equal(regular.canvases,0);assert.equal(regular.created,regular.destroyed);
    report.runs.push({round,pack,before,pauseBefore,pauseAfter,hiddenBefore,hiddenAfter,restored,regular});
    const metrics=app.getAppMetrics().map(p=>({type:p.type,pid:p.pid,memory:p.memory,cpu:p.cpu.percentCPUUsage}));report.memory.push({round,pack,elapsedMs:Date.now()-started,metrics});
    console.log('SOAK_PROGRESS',round+1,pack,'live=0, canvas=0 after regular');
  }
  await window.webContents.executeJavaScript('handle.destroy(); if(typeof gc==="function")gc()');
  report.final=await window.webContents.executeJavaScript(`({...sample(),frames:audit.frames})`);report.elapsedMs=Date.now()-started;
  const intervals=[];for(let i=1;i<report.final.frames.length;i++){const a=report.final.frames[i-1],b=report.final.frames[i];if(a.pack===b.pack&&b.position>a.position&&b.at-a.at<200)intervals.push(b.at-a.at);}intervals.sort((a,b)=>a-b);report.frameIntervals={count:intervals.length,medianMs:intervals[Math.floor(intervals.length*.5)],p95Ms:intervals[Math.floor(intervals.length*.95)],maxMs:intervals.at(-1),note:'Observed adapter frame event spacing in hidden Electron window, not display FPS or render-duration measurement'};
  assert.equal(report.final.active,0);assert.equal(report.final.canvases,0);assert.equal(report.final.created,report.final.destroyed);assert(report.final.maxActive<=1);
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  assert.equal(errors.length,0,errors.map(e=>e.slice(0,180)).join('\n'));
  console.log('LYRIC_STAGE_SHORT_SOAK_PASS',JSON.stringify({elapsedMs:report.elapsedMs,kernels:report.final.created,destroyed:report.final.destroyed,maxActive:report.final.maxActive,contextsCreated:report.final.contextCreated,contextsLost:report.final.contextLost,frameIntervals:report.frameIntervals}));
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{window?.destroy();app.quit()});
