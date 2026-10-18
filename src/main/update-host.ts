import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CHINA_MIRROR, RELEASE_API, REPOSITORY, releaseFromJson, newerVersion, localDay, validateMirror, downloadSources, type UpdateRelease } from './update-feed';

export function attachUpdates(win:BrowserWindow):void {
  const file=path.join(app.getPath('userData'),'updates.json');
  let prefs:{mutedDay?:string;mirror?:string}={mirror:CHINA_MIRROR};try{prefs=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  let release:UpdateRelease|undefined, checking:Promise<unknown>|undefined, downloading=false;
  const save=()=>fs.writeFileSync(file,JSON.stringify(prefs));
  const request=(url:string,timeout=20000)=>net.fetch(url,{headers:{'User-Agent':'Tide/'+app.getVersion(),'Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(timeout)});
  const check=async()=>{
    if(checking)return checking;
    checking=(async()=>{try{
      const response=await request(RELEASE_API);
      if(!response.ok)throw new Error(response.status===404?'更新源暂不可访问，请稍后重试':response.status===403||response.status===429?'检查过于频繁，请稍后重试':'更新服务返回 '+response.status);
      const text=await response.text();if(text.length>1024*1024)throw new Error('发布信息过大');
      release=releaseFromJson(JSON.parse(text));
      return {ok:true,current:app.getVersion(),available:newerVersion(release.version,app.getVersion()),version:release.version,notes:release.notes,mirror:prefs.mirror??''};
    }catch(e){return {ok:false,current:app.getVersion(),message:e instanceof Error?e.message:'检查更新失败',mirror:prefs.mirror??''};}})();
    try{return await checking;}finally{checking=undefined;}
  };
  const download=async()=>{
    if(downloading)return {ok:false,message:'正在下载更新'};
    if(!release||!newerVersion(release.version,app.getVersion()))return {ok:false,message:'请先检查更新'};
    const target=release;downloading=true;
    try{
      let expected=target.sha256;
      if(!expected&&target.checksumUrl){const res=await request(target.checksumUrl);if(!res.ok)throw new Error('无法读取更新校验信息');const text=await res.text();if(text.length>65536)throw new Error('校验信息无效');const row=text.split(/\r?\n/).find(row=>row.trim().endsWith(target.name));const match=row&&/^([a-f\d]{64})\s+\*?(.+)$/i.exec(row.trim());if(match&&match[2]===target.name)expected=match[1]!.toLowerCase();}
      if(!expected)throw new Error('发布方未提供校验信息，已取消下载');
      const chosen=await dialog.showSaveDialog(win,{title:'保存 Tide 更新包',defaultPath:path.join(app.getPath('downloads'),target.name),filters:[{name:'更新包',extensions:['zip']}]});
      if(chosen.canceled||!chosen.filePath)return {ok:false,message:'已取消下载'};
      const partial=chosen.filePath+'.part';let success=false,lastError='';
      for(const url of downloadSources(target,prefs.mirror??'')){
        const controller=new AbortController();let idleTimer=setTimeout(()=>controller.abort(),20000);
        try{
          const res=await net.fetch(url,{headers:{'User-Agent':'Tide/'+app.getVersion()},signal:controller.signal});if(!res.ok||!res.body)throw new Error('下载源返回 '+res.status);
          const hash=crypto.createHash('sha256');let total=0,last=0;
          const meter=new Transform({transform(chunk:Buffer,_encoding,callback){clearTimeout(idleTimer);idleTimer=setTimeout(()=>controller.abort(),30000);total+=chunk.length;if(total>target.size){callback(new Error('更新包大小不符'));return;}hash.update(chunk);if(Date.now()-last>150&&!win.isDestroyed()){last=Date.now();win.webContents.send('tide:update-progress',Math.round(total*100/target.size));}callback(null,chunk);}});
          await pipeline(Readable.fromWeb(res.body as never),meter,fs.createWriteStream(partial));
          if(total!==target.size||hash.digest('hex')!==expected)throw new Error('更新包校验失败');
          fs.renameSync(partial,chosen.filePath);success=true;break;
        }catch(e){lastError=e instanceof Error?e.message:'下载失败';fs.rmSync(partial,{force:true});}finally{clearTimeout(idleTimer);}
      }
      if(!success)throw new Error(lastError);
      const answer=await dialog.showMessageBox(win,{type:'info',title:'更新包已准备好',message:'Tide '+target.version+' 已下载并通过校验',detail:'可以解压并启动新版。旧版文件会保留，账号和设置继续沿用。',buttons:['解压并启动新版','稍后安装'],defaultId:0,cancelId:1});
      if(answer.response===0){
        const dest=path.join(app.getPath('userData'),'updates',target.version+'-'+Date.now());fs.mkdirSync(dest,{recursive:true});
        const quote=(v:string)=>"'"+v.replaceAll("'","''")+"'";
        await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath ${quote(chosen.filePath)} -DestinationPath ${quote(dest)} -ErrorAction Stop`],{windowsHide:true,timeout:120000});
        const executable=path.join(dest,'Tide.exe');if(!fs.existsSync(executable)||!fs.existsSync(path.join(dest,'resources','app.asar')))throw new Error('更新包缺少程序文件');
        const error=await shell.openPath(executable);if(error)throw new Error(error);app.quit();
      }
      return {ok:true,message:'更新包已保存'};
    }catch(e){return {ok:false,message:e instanceof Error?e.message:'下载失败'};}finally{downloading=false;}
  };
  const handlers:Record<string,(...args:unknown[])=>unknown>={
    'tide:update-check':check,
    'tide:update-info':()=>({current:app.getVersion(),mirror:prefs.mirror??''}),
    'tide:update-mirror':(value)=>{try{prefs.mirror=validateMirror(String(value??''));save();return {ok:true};}catch(e){return {ok:false,message:e instanceof Error?e.message:'地址无效'};}},
    'tide:update-download':download,
    'tide:open-project':()=>shell.openExternal(REPOSITORY),
  };
  for(const [name,handler]of Object.entries(handlers)){ipcMain.removeHandler(name);ipcMain.handle(name,(event,...args)=>event.sender===win.webContents?handler(...args):undefined);}
  if(app.isPackaged)win.webContents.once('did-finish-load',()=>{
    const timer=setTimeout(async()=>{if(win.isDestroyed()||prefs.mutedDay===localDay())return;const result=await check() as {ok:boolean;available?:boolean;version?:string};if(!result.ok||!result.available||win.isDestroyed())return;
      const answer=await dialog.showMessageBox(win,{type:'info',title:'Tide 更新',message:'发现新版本 '+result.version,detail:release?.notes.slice(0,3000),buttons:['更新','稍后','今天不再提示'],defaultId:0,cancelId:1});
      if(answer.response===2){prefs.mutedDay=localDay();save();}else if(answer.response===0){const done=await download();if(!done.ok&&!win.isDestroyed())void dialog.showMessageBox(win,{type:'error',message:done.message});}
    },5000);win.once('closed',()=>clearTimeout(timer));
  });
}
