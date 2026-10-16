const { _electron }=require(process.env.TIDE_PLAYWRIGHT_MODULE||'playwright');
const path=require('path'),fs=require('fs');
const out=path.resolve(process.env.TIDE_PERF_OUTPUT||'artifacts/perf-baseline');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const app=await _electron.launch({executablePath:process.env.TIDE_PERF_EXE||require('electron'),args:process.env.TIDE_PERF_EXE?[]:[path.resolve('.')],env:{...process.env,TIDE_USER_DATA:path.join(out,'profile-'+Date.now()),TIDE_API_PORT:'0',TIDE_BUS_PORT:'0'},timeout:60000});
 try {
 const page=await app.firstWindow();await page.waitForFunction(()=>Boolean(window.tide));
 await page.evaluate(()=>localStorage.setItem('tide.risk.ack','1'));await page.reload();
 await page.waitForFunction(async()=>(await window.tide.getHealth()).ok);
 await page.evaluate(()=>{window.frameCalls=0;const raf=requestAnimationFrame;window.requestAnimationFrame=fn=>raf(t=>{window.frameCalls++;fn(t);});});
 const results=[];
 const scenarios=[{shell:'lens',scene:'home'},{shell:'lattice',scene:'home'},{shell:'lens',scene:'lyrics'},{shell:'lattice',scene:'lyrics'}];
 for(const {shell,scene} of scenarios){
  if(scene==='lyrics' && !await page.evaluate(()=>Boolean(window.perfAudioReady))){
   const wav=path.join(out,'perf-60s.wav');
   const audio=Buffer.alloc(44+32000*60);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);fs.writeFileSync(wav,audio);
   const lineMs=Number(process.env.TIDE_PERF_LINE_MS||5000);
   await app.evaluate(({dialog,ipcMain},{file,lineMs})=>{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
    ipcMain.removeHandler('tide:lyric');
    ipcMain.handle('tide:lyric',(_event,id)=>{
     const yrc=Array.from({length:12},(_,i)=>({timeMs:i*lineMs,durationMs:lineMs,text:'持续逐字歌词测试',words:Array.from('持续逐字歌词测试').map((text,j)=>({text,timeMs:i*lineMs+j*lineMs/8,durationMs:lineMs/8}))}));
     return {ok:true,trackId:id,lines:yrc.map(row=>({timeMs:row.timeMs,text:row.text})),translation:[],romaji:[],yrc};
    });
   },{file:wav,lineMs});
   await page.evaluate(async()=>{const hits=await window.tide.addLocalTracks();await window.tide.playHits(hits,0);window.perfAudioReady=true;document.querySelector('audio').loop=true;});
   await page.waitForFunction(()=>document.querySelector('audio')&&!document.querySelector('audio').paused);
   await page.locator('.dock-cover').click();
  }
  await page.evaluate(shell=>window.tide.setAppearance({shell,motion:1,performance:'balanced'}),shell);await page.waitForTimeout(2500);
  const before=await app.evaluate(({app})=>app.getAppMetrics()); const frames=await page.evaluate(()=>window.frameCalls);
  const start=Date.now();await page.waitForTimeout(7000);
  const after=await app.evaluate(({app})=>app.getAppMetrics());
  const seconds=(Date.now()-start)/1000;
  const cpu=after.reduce((sum,p)=>sum+Math.max(0,(p.cpu.cumulativeCPUUsage||0)-(before.find(b=>b.pid===p.pid)?.cpu.cumulativeCPUUsage||0)),0);
  results.push({shell,scene,seconds,cpuSeconds:cpu,cpuOneCorePercent:cpu/seconds*100,memoryMB:after.reduce((s,p)=>s+p.memory.workingSetSize,0)/1024,callbacksPerSecond:((await page.evaluate(()=>window.frameCalls))-frames)/seconds,processes:after.map(p=>({type:p.type,cpu:p.cpu.percentCPUUsage,memory:p.memory.workingSetSize/1024}))});
 }
 console.log(JSON.stringify(results,null,2));fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify(results,null,2));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
