import { BrowserWindow, ipcMain, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { MiniPlayerSettings, DeskCue, MiniCue, PerformanceTier } from "../shared/contract";
import type { PlaybackMachine } from "../core/playback/machine";
const defaults:MiniPlayerSettings={open:false,style:"lens",topmost:true,locked:false,x:null,y:null};
export function attachMiniPlayer(options:{file:string;machine:PlaybackMachine;cue:()=>DeskCue;performance:()=>PerformanceTier;showMain:()=>void}){
 let settings=defaults;try{settings=read(JSON.parse(fs.readFileSync(options.file,"utf8")));}catch{}
 let win:BrowserWindow|null=null,timer:ReturnType<typeof setInterval>|null=null,moveTimer:ReturnType<typeof setTimeout>|null=null,last="";
 const save=()=>{fs.mkdirSync(path.dirname(options.file),{recursive:true});fs.writeFileSync(options.file+".tmp",JSON.stringify(settings),{mode:0o600});fs.renameSync(options.file+".tmp",options.file);};
 const paint=()=>{if(!win||win.isDestroyed()||!win.isVisible()||win.isMinimized())return;const cue:MiniCue={playback:options.machine.nowPlaying(),lyrics:options.cue(),settings,performance:options.performance(),active:true};const value=JSON.stringify(cue);if(last!==value){last=value;win.webContents.send("tide:mini-cue",cue);}};
 const activity=()=>{if(!win||win.isDestroyed())return;const active=win.isVisible()&&!win.isMinimized();win.webContents.send("tide:render-active",active);last="";if(timer)clearInterval(timer);timer=active?setInterval(paint,100):null;paint();};
 const close=()=>{if(timer)clearInterval(timer);timer=null;if(moveTimer)clearTimeout(moveTimer);moveTimer=null;const old=win;if(old&&!old.isDestroyed()){const b=old.getBounds();settings={...settings,x:b.x,y:b.y};save();}win=null;old?.destroy();last="";};
 const ensure=()=>{
  if(!settings.open){close();return;}
  if(!win){const area=screen.getPrimaryDisplay().workArea,width=Math.min(560,area.width),height=198;
   win=new BrowserWindow({width,height,x:settings.x??Math.round(area.x+(area.width-width)/2),y:settings.y??area.y+area.height-height-80,frame:false,transparent:true,alwaysOnTop:settings.topmost,skipTaskbar:true,focusable:false,resizable:false,show:false,hasShadow:false,backgroundColor:"#00000000",webPreferences:{preload:path.join(__dirname,"preload.js"),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:true}});
   const areaFit=screen.getDisplayMatching(win.getBounds()).workArea,b=win.getBounds();win.setPosition(Math.max(areaFit.x,Math.min(b.x,areaFit.x+areaFit.width-b.width)),Math.max(areaFit.y,Math.min(b.y,areaFit.y+areaFit.height-b.height)));
   const current=win;current.on("closed",()=>{if(win===current){win=null;if(timer)clearInterval(timer);timer=null;settings={...settings,open:false};save();}});
   win.once("ready-to-show",()=>{win?.show();activity();});
   win.on("move",()=>{if(moveTimer)clearTimeout(moveTimer);moveTimer=setTimeout(()=>{if(win){const b=win.getBounds();settings={...settings,x:b.x,y:b.y};save();}},180);});
   win.on("hide",activity);win.on("show",activity);win.on("minimize",activity);win.on("restore",activity);
   void win.loadFile(path.join(__dirname,"mini.html"));
  }
  win.setAlwaysOnTop(settings.topmost,settings.topmost?"screen-saver":"normal");win.setIgnoreMouseEvents(settings.locked,{forward:true});last="";paint();
 };
 ipcMain.handle("tide:mini-get",()=>settings);
 ipcMain.handle("tide:mini-set",(_e,patch:unknown)=>{settings=read({...settings,...(patch&&typeof patch==="object"?patch:{})});if(settings.open&&win?.isMinimized())close();save();ensure();return settings;});
 ipcMain.handle("tide:mini-main",()=>options.showMain());
 ipcMain.handle("tide:mini-interactive",(event,interactive:unknown)=>{if(win&&event.sender===win.webContents&&settings.locked)win.setIgnoreMouseEvents(interactive!==true,{forward:true});});
 if(settings.open)ensure();
 return {close(){close();for(const channel of ["tide:mini-get","tide:mini-set","tide:mini-main","tide:mini-interactive"])ipcMain.removeHandler(channel);}};
}
function read(value:unknown):MiniPlayerSettings{const v=value&&typeof value==="object"?value as Record<string,unknown>:{};return {open:v.open===true,style:v.style==="lattice"||v.style==="transparent"?v.style:"lens",topmost:v.topmost!==false,locked:v.locked===true,x:typeof v.x==="number"&&Number.isFinite(v.x)?v.x:null,y:typeof v.y==="number"&&Number.isFinite(v.y)?v.y:null};}
