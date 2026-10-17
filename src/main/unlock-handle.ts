import { BrowserWindow } from "electron";
import path from "node:path";
/** A separate hit-testable handle stays clickable when its owner passes mouse input through. */
export function unlockHandle(owner:BrowserWindow,target:"desk"|"mini"){
 let handle:BrowserWindow|null=null,locked=false;
 const position=()=>{if(!handle||handle.isDestroyed()||owner.isDestroyed())return;const b=owner.getBounds();handle.setBounds({x:b.x+b.width-40,y:b.y+4,width:36,height:36});if(locked&&owner.isVisible()&&!owner.isMinimized())handle.showInactive();else handle.hide();};
 const close=()=>{handle?.destroy();handle=null;};
 owner.on("move",position);owner.on("resize",position);owner.on("show",position);owner.on("hide",position);owner.on("minimize",position);owner.on("restore",position);
 owner.once("closed",close);
 return {sync(value:boolean){locked=value;if(!value){close();return;}if(!handle){handle=new BrowserWindow({width:36,height:36,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,resizable:false,focusable:false,show:false,hasShadow:false,webPreferences:{preload:path.join(__dirname,"preload.js"),contextIsolation:true,nodeIntegration:false,sandbox:true}});handle.setAlwaysOnTop(true,"screen-saver");handle.once("ready-to-show",position);void handle.loadFile(path.join(__dirname,"desk.html"),{query:{unlock:target}});}position();},destroy(){close();owner.removeListener("move",position);owner.removeListener("resize",position);owner.removeListener("show",position);owner.removeListener("hide",position);owner.removeListener("minimize",position);owner.removeListener("restore",position);owner.removeListener("closed",close);}};
}
