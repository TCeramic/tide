const {_electron}=require(process.env.TIDE_PLAYWRIGHT_MODULE||'playwright');const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const out=path.resolve(process.env.TIDE_REFRESH_OUTPUT||'artifacts/high-refresh');fs.mkdirSync(out,{recursive:true});
(async()=>{const app=await _electron.launch({executablePath:process.env.TIDE_TEST_EXE||require('electron'),args:process.env.TIDE_TEST_EXE?[]:[path.resolve('.')],env:{...process.env,TIDE_USER_DATA:path.join(out,'profile-'+Date.now()),TIDE_API_PORT:'0',TIDE_BUS_PORT:'0'}});
try{const page=await app.firstWindow();await page.waitForFunction(()=>Boolean(window.tide));await page.evaluate(()=>localStorage.setItem('tide.risk.ack','1'));await page.reload();await page.waitForFunction(async()=>(await window.tide.getHealth()).ok);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1700,height:1060}));
const results=[];
for(const tier of ['balanced','vivid']){await page.evaluate(tier=>window.tide.setAppearance({shell:'lattice',performance:tier,motion:1}),tier);await page.waitForTimeout(1200);await page.mouse.move(800,600);await page.evaluate(()=>document.documentElement.dataset.dockVisible='true');
await page.evaluate(()=>{const input=document.querySelector('input[aria-label="进度"]');input.max='1000';input.value='500';input.dataset.playing='true';input.dispatchEvent(new Event('tide:progress'));window.draws={cursor:0,progress:0,background:0,raf:0}; document.body.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:800,clientY:600,pointerType:'mouse'}));
for(const [key,selector] of [['cursor','.lx-cursor'],['progress','.native-point-progress canvas']]){const g=document.querySelector(selector).getContext('2d');if(!g.fixtureOriginalClear)g.fixtureOriginalClear=g.clearRect;const original=g.fixtureOriginalClear;g.clearRect=function(...args){window.draws[key]++;return original.apply(this,args);};}
const gl=document.querySelector('.native-point-field').getContext('webgl2');const bind=gl.bindFramebuffer,draw=gl.drawArrays;let framebuffer=null;gl.bindFramebuffer=function(target,value){framebuffer=value;return bind.call(this,target,value);};gl.drawArrays=function(...args){if(framebuffer===null)window.draws.background++;return draw.apply(this,args);};
if(!window.countingRaf){window.countingRaf=true;const count=()=>{window.draws.raf++;requestAnimationFrame(count);};requestAnimationFrame(count);}});
await page.waitForTimeout(300);await page.evaluate(()=>Object.keys(window.draws).forEach(k=>window.draws[k]=0));const start=Date.now();await page.waitForTimeout(3000);const seconds=(Date.now()-start)/1000;
const row=await page.evaluate(({seconds,tier})=>({tier,...Object.fromEntries(Object.entries(window.draws).map(([k,v])=>[k,v/seconds])),pixels:document.querySelector('.native-point-field').width*document.querySelector('.native-point-field').height}),{seconds,tier});
// Background is recreated on tier changes, so its instrumented draw method is never reused.
assert.ok(row.pixels<=(tier==='vivid'?1810000:1110000));assert.ok(row.cursor<=125&&row.progress<=125&&row.background<=125);
if(tier==='vivid'){const minimum=Math.min(80,row.raf*.65);for(const key of ['cursor','progress','background'])assert.ok(row[key]>=minimum,`${key} ${row[key]} below ${minimum}`);}
results.push(row);}
console.log(JSON.stringify(results,null,2));fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify(results,null,2));console.log('HIGH_REFRESH_BOUNDED_DRAW_RATES passed');
}finally{await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
