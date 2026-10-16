const {_electron}=require(process.env.TIDE_PLAYWRIGHT_MODULE||'playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const out=path.resolve('artifacts/cursor-hold');fs.mkdirSync(out,{recursive:true});
(async()=>{const app=await _electron.launch({executablePath:require('electron'),args:[path.resolve('.')],env:{...process.env,TIDE_USER_DATA:path.join(out,'profile-'+Date.now()),TIDE_API_PORT:'0',TIDE_BUS_PORT:'0'}});
try{const page=await app.firstWindow();await page.waitForFunction(()=>Boolean(window.tide));await page.evaluate(()=>localStorage.setItem('tide.risk.ack','1'));await page.reload();await page.waitForFunction(async()=>(await window.tide.getHealth()).ok);
await page.evaluate(()=>window.tide.setAppearance({shell:'lattice',performance:'vivid',motion:1}));await page.waitForSelector('.lx-cursor');await page.waitForTimeout(1000);
const ring=page.locator('.lx-cursor');await page.mouse.move(620,480);await page.waitForTimeout(700);
await page.mouse.down();await page.waitForFunction(()=>document.querySelector('.lx-cursor')?.dataset.press==='holding');await page.waitForTimeout(800);
assert.equal(await ring.getAttribute('data-press'),'held');
const pixels=await ring.evaluate(cv=>{const b=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let hot=0;for(let i=0;i<b.length;i+=4)if(b[i]>160&&b[i]>b[i+1]*1.3&&b[i+3]>70)hot++;return hot;});assert.ok(pixels>30,`held hot pixels ${pixels}`);
await page.screenshot({path:path.join(out,'held.png')});await page.mouse.up();await page.waitForFunction(()=>document.querySelector('.lx-cursor')?.dataset.press==='idle');
// Releasing outside the window, losing focus, or changing tier cannot leave a hot halo.
for(const name of ['blur','pointercancel']){await page.mouse.down();await page.waitForTimeout(100);await page.evaluate(name=>{if(name==='pointercancel')window.dispatchEvent(new PointerEvent(name,{pointerId:1}));else window.dispatchEvent(new Event(name));},name);await page.waitForFunction(()=>document.querySelector('.lx-cursor')?.dataset.press==='idle');await page.mouse.up();}
await page.mouse.down();await page.waitForTimeout(100);await page.evaluate(()=>window.tide.setAppearance({performance:'smooth'}));await page.waitForFunction(()=>document.querySelector('.lx-cursor')?.dataset.press==='idle');await page.mouse.up();
await page.mouse.down();await page.waitForTimeout(850);assert.equal(await ring.getAttribute('data-press'),'idle');await page.mouse.up();
await page.evaluate(()=>window.tide.setAppearance({performance:'balanced'}));await page.waitForTimeout(700);
const home=page.locator('button[aria-label="主页"]');if(await home.count()){await home.click();}
await page.mouse.down();await page.waitForTimeout(800);await page.evaluate(()=>window.tide.setAppearance({shell:'lens'}));await page.waitForTimeout(800);assert.equal(await page.locator('.lx-cursor').count(),0);await page.mouse.up();
console.log('CURSOR_HOLD_GATHER_HEAT_PULSE_RELEASE_CANCEL_LOW_THEME_CLEANUP passed');
}finally{await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
