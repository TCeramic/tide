const {_electron}=require(process.env.TIDE_PLAYWRIGHT_MODULE||'playwright'),path=require('path'),fs=require('fs'),assert=require('assert/strict');
const out=path.resolve('artifacts/theme-native');fs.mkdirSync(out,{recursive:true});
(async()=>{const app=await _electron.launch({executablePath:process.env.TIDE_TEST_EXE||require('electron'),args:process.env.TIDE_TEST_EXE?[]:[path.resolve('.')],env:{...process.env,TIDE_USER_DATA:path.join(out,'profile-'+Date.now()),TIDE_API_PORT:'0',TIDE_BUS_PORT:'0'}});try{const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(async()=>Boolean(window.tide)&&(await window.tide.getHealth()).ok);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1700,height:1050}));await page.evaluate(()=>window.tide.setAppearance({shell:'lattice',latticeMode:'dark',background:'paper',performance:'vivid'}));await page.waitForTimeout(2000);const records=[];
for(const [index,patch]of [{shell:'lens',lensMode:'light'},{lensMode:'dark'},{shell:'lattice',latticeMode:'light'},{shell:'lens',lensMode:'dark'},{background:'pixel-cover',lensMode:'light'},{lensMode:'dark'}].entries()){
 await page.evaluate(p=>window.tide.setAppearance(p),patch);await page.waitForSelector(".theme-reveal-frame");const samples=[];
 for(const delay of [100,500,500,1400]){await page.waitForTimeout(delay);samples.push(await page.evaluate(async checkCorner=>{
  const overlay=document.querySelector('.theme-reveal-frame');const radius=Number(overlay?.dataset.radius),target=Number(overlay?.dataset.target);
  const corner=async src=>{const image=new Image();image.src=src;await image.decode();const c=document.createElement('canvas');c.width=c.height=8;const g=c.getContext('2d');g.drawImage(image,image.naturalWidth-12,image.naturalHeight-12,8,8,0,0,8,8);const d=g.getImageData(0,0,8,8).data;const rgb=[0,0,0];for(let i=0;i<d.length;i+=4)for(let k=0;k<3;k++)rgb[k]+=d[i+k]/64;return rgb;};
  let difference=null;if(overlay&&checkCorner){const before=await corner(overlay.src),actual=await corner(await window.tide.captureThemeFrame());difference=Math.max(...before.map((v,i)=>Math.abs(v-actual[i])));}
  const c=document.querySelector('body>.lg-canvas');let mean=null,black=null;if(c){const t=document.createElement('canvas');t.width=40;t.height=30;const g=t.getContext('2d');g.drawImage(c,0,0,40,30);const d=g.getImageData(0,0,40,30).data;let sum=0,n=0;for(let i=0;i<d.length;i+=4){sum+=d[i]+d[i+1]+d[i+2];if(d[i]+d[i+1]+d[i+2]<15)n++;}mean=sum/3600;black=n/1200;}return {mean,black,radius:overlay?radius:null,target:overlay?target:null,difference,dpr:devicePixelRatio};
 },samples.length===2));}
 await page.screenshot({path:path.join(out,`mode-${index}.png`)});
 assert.ok(samples[0].radius>0&&samples[1].radius>samples[0].radius&&samples[2].radius>samples[1].radius&&samples[2].radius<samples[2].target,JSON.stringify({patch,samples}));
 for(const s of samples.slice(2,3))assert.ok(s.difference<5,`bottom-right must keep old pixels until reached: ${JSON.stringify({patch,s})}`);
 assert.equal(samples[3].radius,null);
 if(patch.shell!=='lattice')for(const s of samples)assert.ok(s.mean>10&&s.black<.5,JSON.stringify({patch,samples}));
 records.push({patch,samples});
}
assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(records,null,2));console.log('NATIVE_REAL_PIXEL_CORNER_PRESERVED_UNTIL_RADIUS_REACHES_IT_NO_BLACK_LENS_AND_BOTH_BACKGROUNDS passed',JSON.stringify(records));
}finally{await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
