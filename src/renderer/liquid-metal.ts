import { ShaderMount,liquidMetalFragmentShader,LiquidMetalShapes,getShaderColorFromString } from "@paper-design/shaders";
import { isRenderingActive } from "./render-activity";
import type { Appearance } from "../shared/contract";
export function mountLiquidMetal(root:HTMLElement){
 const host=document.createElement('div');host.className='liquid-metal-emblem';host.setAttribute('aria-label','TIDE 液态金属');root.append(host);
 let mount:ShaderMount|null=null,current:Appearance|null=null,frame=0,timer=0,scrollFrame=0,phase=0,last=0,dead=false;
 const home=root.querySelector<HTMLElement>('.home-grid');
 function visible(){return !dead&&Boolean(current?.emblem==='liquid-metal'||(current?.shell==='lens'&&(document.documentElement.dataset.mobile==='true'||document.documentElement.dataset.view!=='playing')))&&(document.documentElement.dataset.view==='playing'||!home?.hidden)&&isRenderingActive();}
 function stop(){cancelAnimationFrame(frame);clearTimeout(timer);frame=timer=0;last=0;}
 function tick(now:number){frame=0;if(!visible())return;phase+=last?Math.min(80,now-last)*.45:0;last=now;mount?.setFrame(phase);if(current?.performance!=='smooth'&&current?.motion&&!matchMedia('(prefers-reduced-motion: reduce)').matches)timer=window.setTimeout(()=>{timer=0;frame=requestAnimationFrame(tick);},33);}
 function place(slot:DOMRect,origin:DOMRect,width:number,height:number,topbar?:DOMRect,dock?:DOMRect){
  // The emblem is absolutely positioned inside #app (a fixed layer), so viewport coordinates must be
  // rebased on that layer. Clamping it between the search bar and the dock keeps it behind the chrome
  // while the masthead scrolls away instead of letting it float over the search field.
  const left=slot.left-origin.left+(slot.width-width)/2,top=slot.top-origin.top+(slot.height-height)/2;
  host.style.width=width+'px';host.style.height=height+'px';host.style.left=left+'px';host.style.top=top+'px';
  const minTop=(topbar?topbar.bottom:0)-origin.top;
  const maxBottom=(dock&&dock.height?dock.top:window.innerHeight)-origin.top;
  host.style.clipPath=`inset(${Math.max(0,minTop-top)}px 0 ${Math.max(0,top+height-maxBottom)}px 0)`;
 }
 function refresh(){
  stop();const show=visible();host.hidden=!show;if(!show){mount?.dispose();mount=null;return;}
  const playing=document.documentElement.dataset.view==='playing',mobile=document.documentElement.dataset.mobile==='true';
  if(mobile){
   const slot=document.querySelector(playing?'.mobile-emblem-slot':'.brand-space')?.getBoundingClientRect();
   const origin=root.getBoundingClientRect();
   const topbar=document.querySelector('.topbar')?.getBoundingClientRect();
   const dock=document.querySelector('.transport')?.getBoundingClientRect();
   if(slot)place(slot,origin,slot.width,slot.height,topbar,dock);
   else host.style.clipPath='none';
  }else{
   const box=(playing?document.querySelector('.lyrics-cover'):home)?.getBoundingClientRect(),art=document.querySelector(playing?'.lyrics-cover':'.home-wordmark')?.getBoundingClientRect()??document.querySelector('.home-cover')?.getBoundingClientRect();const width=playing?Math.min(320,Math.max(180,art?.width??280)):Math.min(320,art?.width??280),height=playing?Math.min(88,Math.max(36,(art?.top??150)-52)):Math.max(36,art?.height??64);host.style.width=width+'px';host.style.height=height+'px';host.style.left=((art?.left??box?.left??0)+(art?.width??width)/2-width/2)+'px';host.style.top=(playing?Math.max(36,(art?.top??150)-height-12):(art?.top??Math.max(102,(box?.top??240)-104)))+'px';
   if(!playing&&home){const viewport=home.getBoundingClientRect(),rect=host.getBoundingClientRect();host.style.clipPath=`inset(${Math.max(0,viewport.top-rect.top)}px ${Math.max(0,rect.right-viewport.right)}px ${Math.max(0,rect.bottom-viewport.bottom)}px ${Math.max(0,viewport.left-rect.left)}px)`;}else host.style.clipPath="none";
  }
  if(!mount)try{mount=new ShaderMount(host,liquidMetalFragmentShader,{u_colorBack:getShaderColorFromString('#111a2400'),u_colorTint:getShaderColorFromString('#eaf6ff'),u_repetition:2.2,u_softness:.18,u_shiftRed:.12,u_shiftBlue:.16,u_distortion:.08,u_contour:.35,u_angle:65,u_shape:LiquidMetalShapes.none,u_isImage:false,u_fit:1,u_scale:.7,u_rotation:0,u_originX:.5,u_originY:.5,u_offsetX:0,u_offsetY:0,u_worldWidth:0,u_worldHeight:0}, {alpha:true,preserveDrawingBuffer:true},0,phase,1,70000);host.dataset.ready='true';}catch(e){host.dataset.error=String(e);}
  frame=requestAnimationFrame(tick);
 }
 const scrollRefresh=()=>{if(scrollFrame)return;scrollFrame=requestAnimationFrame(()=>{scrollFrame=0;refresh();});};
 const mobileScroll=document.querySelector('.mobile-scroll');
 mobileScroll?.addEventListener('scroll',scrollRefresh,{passive:true});
 const resize=new ResizeObserver(refresh);if(home)resize.observe(home);const lyricCover=document.querySelector(".lyrics-cover");if(lyricCover)resize.observe(lyricCover);const homeWordmark=document.querySelector(".home-wordmark");if(homeWordmark)resize.observe(homeWordmark);home?.addEventListener("scroll",scrollRefresh,{passive:true});
 const view=new MutationObserver(refresh);view.observe(document.documentElement,{attributes:true,attributeFilter:['data-view','data-player-view','data-render-active']});if(home)view.observe(home,{attributes:true,attributeFilter:['hidden']});window.addEventListener('resize',refresh);document.addEventListener('visibilitychange',refresh);
 return{sync(a:Appearance){current=a;refresh();},destroy(){dead=true;stop();cancelAnimationFrame(scrollFrame);resize.disconnect();view.disconnect();home?.removeEventListener("scroll",scrollRefresh);mobileScroll?.removeEventListener('scroll',scrollRefresh);window.removeEventListener('resize',refresh);document.removeEventListener('visibilitychange',refresh);mount?.dispose();host.remove();}};
}
