import { isRenderingActive } from "./render-activity";
import { ShaderMount, meshGradientFragmentShader, getShaderColorFromString } from "@paper-design/shaders";
import type { Appearance } from "../shared/contract";
import type { GeneratedTheme } from "../core/generated-theme";
import { sampleAudioReactivity } from "./audio-reactivity";

// One GPU pass for upstream mesh, cover tint and a tonal pixel screen.
const tideMeshShader=meshGradientFragmentShader.replace('uniform float u_time;',`uniform float u_time;
uniform vec2 u_resolution;
uniform float u_pixelRatio;
uniform float u_beat;
uniform float u_pixels;
uniform float u_coverMix;
uniform sampler2D u_cover;
uniform float u_coverAspectRatio;
uniform sampler2D u_previousCover;
uniform float u_previousCoverAspectRatio;
uniform float u_coverFade;`).replace('fragColor = vec4(color, opacity);',`
  if (u_coverMix > 0.) {
    vec2 screenUV=gl_FragCoord.xy/u_resolution;
    screenUV.y=1.-screenUV.y;
    float viewAspect=u_resolution.x/u_resolution.y;
    vec2 coverUV=(screenUV-.5)*vec2(min(1.,viewAspect/u_coverAspectRatio),min(1.,u_coverAspectRatio/viewAspect))+.5;
    vec2 oldUV=(screenUV-.5)*vec2(min(1.,viewAspect/u_previousCoverAspectRatio),min(1.,u_previousCoverAspectRatio/viewAspect))+.5;
    vec3 art=mix(texture(u_previousCover,oldUV).rgb,texture(u_cover,coverUV).rgb,u_coverFade);
    float tone=dot(art,vec3(.2126,.7152,.0722));
    color=mix(color,art*.35+color*(.32+tone*1.05),u_coverMix);
  }
  float luminance=dot(color,vec3(.2126,.7152,.0722));
  vec2 cell=fract(gl_FragCoord.xy/max(2.,5.*u_pixelRatio))-.5;
  float tideDotRadius=mix(.12,.43,clamp(luminance*1.3+u_beat*.16,0.,1.));
  float dotMask=1.-smoothstep(tideDotRadius-.06,tideDotRadius+.02,length(cell));
  color*=mix(1.,mix(.55,1.25,dotMask),u_pixels);
  color*=1.+u_beat*.18;
  fragColor = vec4(color, opacity);`);

/** Original Apache-2.0 Paper shader, with Tide lifecycle and bounded resolution. */
export function mountPaperBackground(root: HTMLElement, invalidate: () => void) {
  const host = document.createElement("div"); host.className = "native-paper-source"; host.setAttribute("aria-hidden", "true"); root.prepend(host);
  let shader: ShaderMount | null = null;
  let batching=false,renderOnce:((time:number)=>void)|null=null;
  let frame = 0, copyTimer = 0, shaderTime = 0, lastTick = 0, lastCopy = 0, dead = false, current: Appearance | null = null;
  let colors = ["#101a27", "#427d92", "#ad91af", "#23394b"];
  const fallback=new Image();fallback.src='./assets/today-tide.png';
  let cover=fallback,previousCover=fallback,coverFade=1,coverStart=0,coverRequest=0,beat=0,bass=0;
  const isPaper=(value:Appearance|null)=>value?.background==='paper'||value?.background==='pixel-cover';
  let displayed: number[][] = colors.map(color=>getShaderColorFromString(color));
  let blend: {from:number[][];to:number[][];start:number;duration:number}|null=null;
  const uniforms = () => ({
    u_beat:beat,u_pixels:current?.performance==='smooth'?0:.6,u_coverMix:current?.background==='pixel-cover'?1:0,u_cover:cover,u_previousCover:previousCover,u_coverFade:coverFade,
    u_colors: displayed.map(([r,g,b,a]) => { const light=(current?.shell==="lattice"?current.latticeMode:current?.lensMode)==="light",gain=light?.65:.52,lift=light?.32:.015;return [r*gain+lift,g*gain+lift,b*gain+lift,a]; }), u_colorsCount: displayed.length, u_distortion: 0.72, u_swirl: 0.65, u_grainMixer: 0.03, u_grainOverlay: 0.025,
    u_fit: 2, u_scale: 1, u_rotation: 0, u_originX: 0.5, u_originY: 0.5, u_offsetX: 0, u_offsetY: 0, u_worldWidth: 0, u_worldHeight: 0,
  });
  const palette = (event: Event) => {
    const detail = (event as CustomEvent<GeneratedTheme>).detail;
    if (detail?.colors) {
      colors = detail.colors;
      const target=colors.map(color=>getShaderColorFromString(color));
      if(shader&&current?.performance!=="smooth"&&current?.motion&& !matchMedia("(prefers-reduced-motion: reduce)").matches){
        const count=Math.max(displayed.length,target.length);
        blend={from:Array.from({length:count},(_,i)=>[...displayed[i%displayed.length]!]),to:Array.from({length:count},(_,i)=>[...target[i%target.length]!]),start:performance.now(),duration:current.performance==="vivid"?1100:700};
        host.dataset.colorTransition="true";
      }else{displayed=target;blend=null;host.dataset.colorTransition="false";shader?.setUniforms(uniforms());}
      wake();
    }
  };
  const copyFrame = (time: number) => {
    frame = 0;
    if (dead || !current || !isPaper(current)) return;
    if (!isRenderingActive()) { lastTick = 0; return; }
    if(current.performance!=='smooth'&&current.motion>0&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const audio=sampleAudioReactivity(time);beat=audio.beat;bass=audio.bass;}else beat=bass=0;
    shaderTime += (lastTick ? Math.min(100, time - lastTick) : 0) * current.motion * (.65+bass*.5+beat*.45); lastTick = time;
    const interval=current.performance==="smooth"?1000:current.performance==="vivid"?1000/60:1000/30;
    if (time - lastCopy >= interval || lastCopy === 0) {
      batching=true;
      if(blend){const t=Math.min(1,Math.max(0,(time-blend.start)/blend.duration)),ease=t*t*(3-2*t);
        displayed=blend.from.map((color,i)=>color.map((value,c)=>value+(blend!.to[i]![c]!-value)*ease));
        if(t===1){blend=null;host.dataset.colorTransition="false";}
        shader?.setUniforms(uniforms());
      }
      if(coverFade<1){coverFade=Math.min(1,(time-coverStart)/900);if(coverFade===1)previousCover=cover;}
      shader?.setUniforms({u_beat:beat,u_distortion:.72+beat*.18,u_swirl:.65+bass*.2,u_coverFade:coverFade});
      host.dataset.beat=beat.toFixed(3);
      shader?.setFrame(shaderTime);batching=false;renderOnce?.(time); invalidate(); lastCopy = time;
    }
    if (current.performance!=="smooth" && current.motion > 0 && !matchMedia("(prefers-reduced-motion: reduce)").matches) copyTimer = window.setTimeout(() => { copyTimer = 0; frame = requestAnimationFrame(copyFrame); }, interval);
  };
  const wake = () => { shader?.setSpeed(0); cancelAnimationFrame(frame); clearTimeout(copyTimer); copyTimer = 0; frame = 0; lastTick = 0; lastCopy = 0; if (!dead && isRenderingActive()) frame = requestAnimationFrame(copyFrame); };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("tide:palette", palette);
  const artwork=(event:Event)=>{const url=(event as CustomEvent<{url:string}>).detail?.url;if(!url)return;const token=++coverRequest,image=new Image();image.crossOrigin='anonymous';image.onload=()=>{if(dead||token!==coverRequest)return;previousCover=cover;cover=image;coverFade=current?.performance==='smooth'?1:0;coverStart=performance.now();shader?.setUniforms({u_cover:cover,u_previousCover:previousCover,u_coverFade:coverFade});wake();};image.onerror=()=>{};image.src=url;};
  window.addEventListener('tide:artwork',artwork);
  const api = {
    get canvas() { return host.querySelector("canvas"); },
    sync(next: Appearance) {
      current = next;
      const active = isPaper(next);
      if (active && !shader && fallback.complete && fallback.naturalWidth>0) {
        try {
          const stored = JSON.parse(document.documentElement.style.getPropertyValue("--generated-colors") || "null");
          if (Array.isArray(stored)) colors = stored;
          displayed=colors.map(color=>getShaderColorFromString(color));blend=null;host.dataset.colorTransition="false";
          shader = new ShaderMount(host, tideMeshShader, uniforms(), { alpha: false, preserveDrawingBuffer: true }, 0, 0, 1, next.performance === "smooth" ? 500000 : 1000000);
          const driver=shader as unknown as {render:(time:number)=>void};renderOnce=driver.render;driver.render=time=>{if(!batching)renderOnce?.(time);};
          host.dataset.ready = "true";
        } catch (error) { host.dataset.ready = "fallback";host.dataset.error=String(error); }
      }
      if(!active&&shader){shader.dispose();shader=null;renderOnce=null;delete host.dataset.ready;}
      host.dataset.active = String(active);
      host.style.opacity = active && next.shell === "lattice" ? "0.65" : "0";
      shader?.setSpeed(0);
      shader?.setMaxPixelCount(next.performance === "smooth" ? 500000 : 1000000);
      shader?.setUniforms(uniforms());
      shader?.setFrame(shaderTime);
      wake();
    },
    destroy() { dead = true;fallback.onload=null;coverRequest++; clearTimeout(copyTimer); cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", wake); window.removeEventListener("tide:palette", palette);window.removeEventListener('tide:artwork',artwork); shader?.dispose(); host.remove(); },
  };
  fallback.onload=()=>{if(!dead&&current)api.sync(current);};
  return api;
}
