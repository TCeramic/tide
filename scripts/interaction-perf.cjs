const { _electron }=require(process.env.TIDE_PLAYWRIGHT_MODULE||'playwright');
const fs=require('fs'),path=require('path');
const out=path.resolve(process.env.TIDE_INTERACTION_OUTPUT||'artifacts/interaction-perf');fs.mkdirSync(out,{recursive:true});
(async()=>{const app=await _electron.launch({executablePath:process.env.TIDE_TEST_EXE||require('electron'),args:process.env.TIDE_TEST_EXE?[]:[path.resolve('.')],env:{...process.env,TIDE_USER_DATA:path.join(out,'profile-'+Date.now()),TIDE_API_PORT:'0',TIDE_BUS_PORT:'0'}});
try {const page=await app.firstWindow();await page.waitForFunction(()=>Boolean(window.tide));await page.evaluate(()=>localStorage.setItem('tide.risk.ack','1'));await page.reload();await page.waitForFunction(async()=>(await window.tide.getHealth()).ok);
await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1700,height:1060}));
await page.evaluate(()=>window.tide.setAppearance({shell:'lattice',motion:1,performance:'balanced'}));await page.waitForTimeout(1500);
const results=[];
for(const mode of ['idle','pointer','hover','no-cursor','no-field']) {
 await page.evaluate(mode=>{window.probeMode=mode;window.probeFrames=[];window.probePointer=mode!=='idle';if(mode==='no-cursor'){const cv=document.querySelector('.lx-cursor');cv.style.display='none';const g=cv.getContext('2d');for(const key of ['clearRect','arc','fill','beginPath'])g[key]=()=>{};}if(mode==='no-field'){const cv=document.querySelector('.native-point-field');cv.style.display='none';const g=cv.getContext('webgl2');for(const key of ['drawArrays','drawElements'])g[key]=()=>{};}
 if(!window.probeLoop){window.probeLoop=true;let last=0,n=0;const tick=t=>{if(last)window.probeFrames.push(t-last);last=t;if(window.probePointer){const hover=window.probeMode==='hover',x=hover?1330:900+Math.sin(n*.1)*350,y=hover?70:650+Math.cos(n*.13)*120;const el=document.elementFromPoint(x,y);for(let i=0;i<4;i++)el?.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:x,clientY:y,movementX:2,movementY:2,pointerType:'mouse'}));n++;}requestAnimationFrame(tick);};requestAnimationFrame(tick);}},mode);
 await page.waitForTimeout(1000);await page.evaluate(()=>window.probeFrames=[]);const before=await app.evaluate(({app})=>app.getAppMetrics());const started=Date.now();await page.waitForTimeout(4000);const after=await app.evaluate(({app})=>app.getAppMetrics());
 const gaps=await page.evaluate(()=>window.probeFrames);gaps.sort((a,b)=>a-b);const rasterPixels=await page.evaluate(()=>Object.fromEntries(['.lx-cursor','.native-point-field'].map(selector=>{const cv=document.querySelector(selector);return [selector,cv.width*cv.height];})));
 const cpuSeconds=after.reduce((sum,p)=>sum+Math.max(0,(p.cpu.cumulativeCPUUsage||0)-(before.find(b=>b.pid===p.pid)?.cpu.cumulativeCPUUsage||0)),0);
 results.push({mode,rasterPixels,cpuOneCorePercent:cpuSeconds/((Date.now()-started)/1000)*100,cpuReported:after.reduce((s,p)=>s+p.cpu.percentCPUUsage,0),memoryMB:after.reduce((s,p)=>s+p.memory.workingSetSize,0)/1024,frames:gaps.length,p95:gaps[Math.floor(gaps.length*.95)],over33:gaps.filter(x=>x>33).length/gaps.length});
}
fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
