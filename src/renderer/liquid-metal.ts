import { ShaderMount,liquidMetalFragmentShader,LiquidMetalShapes,getShaderColorFromString } from "@paper-design/shaders";
import { isRenderingActive } from "./render-activity";
import type { Appearance } from "../shared/contract";
export function mountLiquidMetal(root:HTMLElement){
 const host=document.createElement('div');host.className='liquid-metal-emblem';host.setAttribute('aria-label','TIDE 液态金属');root.append(host);
 let mount:ShaderMount|null=null,current:Appearance|null=null,frame=0,timer=0,phase=0,last=0,dead=false;
 const home=root.querySelector<HTMLElement>('.home-grid');
 function visible(){return !dead&&Boolean(current?.emblem==='liquid-metal'||(current?.shell==='lens'&&(document.documentElement.dataset.mobile==='true'||document.documentElement.dataset.view!=='playing')))&&(document.documentElement.dataset.view==='playing'||!home?.hidden)&&isRenderingActive();}
 function stop(){cancelAnimationFrame(frame);clearTimeout(timer);frame=timer=0;last=0;}
 function tick(now:number){frame=0;if(!visible())return;phase+=last?Math.min(80,now-last)*.45:0;last=now;mount?.setFrame(phase);if(current?.performance!=='smooth'&&current?.motion&&!matchMedia('(prefers-reduced-motion: reduce)').matches)timer=window.setTimeout(()=>{timer=0;frame=requestAnimationFrame(tick);},33);}
 function refresh(){stop();const show=visible();host.hidden=!show;if(!show){mount?.dispose();mount=null;return;}const playing=document.documentElement.dataset.view==='playing',mobile=document.documentElement.dataset.mobile==='true';
 if(mobile){const slot=document.querySelector(playing?'.mobile-emblem-slot':'.brand-space')?.getBoundingClientRect();if(slot){const width=Math.min(playing?132:280,slot.width),height=Math.min(playing?38:88,slot.height);host.style.width=width+'px';host.style.height=height+'px';host.style.left=(slot.left+(slot.width-width)/2)+'px';host.style.top=(slot.top+(slot.height-height)/2)+'px';}}
 else{const playing=document.documentElement.dataset.view==='playing',box=(playing?document.querySelector('.lyrics-cover'):home)?.getBoundingClientRect(),art=document.querySelector(playing?'.lyrics-cover':'.home-cover')?.getBoundingClientRect();const width=Math.min(320,Math.max(180,art?.width??280)),height=playing?Math.min(88,Math.max(36,(art?.top??150)-52)):88;host.style.width=width+'px';host.style.height=height+'px';host.style.left=((art?.left??box?.left??0)+(art?.width??width)/2-width/2)+'px';host.style.top=(playing?Math.max(36,(art?.top??150)-height-12):Math.max(102,(box?.top??240)-104))+'px';}

 if(!mount)try{mount=new ShaderMount(host,liquidMetalFragmentShader,{u_colorBack:getShaderColorFromString('#111a2400'),u_colorTint:getShaderColorFromString('#eaf6ff'),u_repetition:2.2,u_softness:.18,u_shiftRed:.12,u_shiftBlue:.16,u_distortion:.08,u_contour:.35,u_angle:65,u_shape:LiquidMetalShapes.none,u_isImage:false,u_fit:1,u_scale:.7,u_rotation:0,u_originX:.5,u_originY:.5,u_offsetX:0,u_offsetY:0,u_worldWidth:0,u_worldHeight:0}, {alpha:true,preserveDrawingBuffer:true},0,phase,1,70000);host.dataset.ready='true';}catch(e){host.dataset.error=String(e);}
 frame=requestAnimationFrame(tick);}
 const resize=new ResizeObserver(refresh);if(home)resize.observe(home);const lyricCover=document.querySelector(".lyrics-cover");if(lyricCover)resize.observe(lyricCover);
 const view=new MutationObserver(refresh);view.observe(document.documentElement,{attributes:true,attributeFilter:['data-view','data-player-view','data-render-active']});if(home)view.observe(home,{attributes:true,attributeFilter:['hidden']});window.addEventListener('resize',refresh);document.addEventListener('visibilitychange',refresh);
 return{sync(a:Appearance){current=a;refresh();},destroy(){dead=true;stop();resize.disconnect();view.disconnect();window.removeEventListener('resize',refresh);document.removeEventListener('visibilitychange',refresh);mount?.dispose();host.remove();}};
}
