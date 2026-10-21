/** One shared analyser; sampled only by a visible background's existing clock. */
let analyser: AnalyserNode | null=null, audio: HTMLAudioElement | null=null;
let bins: Uint8Array<ArrayBuffer> | null=null, previous=0, average=.05, pulse=0, sampled=0;
export function attachAudioReactivity(element:HTMLAudioElement):()=>void {
  audio=element;
  let context:AudioContext|null=null,source:MediaElementAudioSourceNode|null=null;
  const start=()=>{try{if(!context){context=new AudioContext();source=context.createMediaElementSource(element);analyser=context.createAnalyser();analyser.fftSize=512;analyser.smoothingTimeConstant=.45;bins=new Uint8Array(analyser.frequencyBinCount);source.connect(analyser);analyser.connect(context.destination);}void context.resume().catch(()=>{});}catch{analyser=null;}};
  element.addEventListener('play',start);
  return ()=>{element.removeEventListener('play',start);source?.disconnect();analyser?.disconnect();void context?.close();analyser=null;audio=null;bins=null;pulse=previous=sampled=0;};
}
export type ReactivitySample={bass:number;beat:number};
let virtual: (()=>ReactivitySample)|null=null;
/** Mobile plays through Android's MediaPlayer, so there is no audio element to analyse.
 *  A transport-driven envelope stands in for the FFT and keeps the background breathing. */
export function attachVirtualReactivity(source:()=>ReactivitySample):()=>void{virtual=source;return ()=>{if(virtual===source)virtual=null;};}
export function sampleAudioReactivity(now:number):{bass:number;beat:number}{
  const dt=sampled?Math.min(.15,(now-sampled)/1000):1/30;sampled=now;
  if(!analyser||!bins||!audio||audio.paused){
    if(virtual){const sample=virtual();const bass=Math.max(0,Math.min(1,sample.bass));pulse=Math.max(pulse*Math.exp(-dt*9),Math.max(0,Math.min(1,sample.beat)));return {bass,beat:pulse};}
    pulse*=Math.exp(-dt*9);return {bass:0,beat:pulse};}
  analyser.getByteFrequencyData(bins);
  const count=Math.max(2,Math.ceil(220/(analyser.context.sampleRate/analyser.fftSize)));
  let energy=0;for(let i=1;i<=count;i++)energy+=(bins[i]??0)/255;energy/=count;
  average+=(energy-average)*(1-Math.exp(-dt*2));
  const onset=Math.max(0,energy-previous)*4+Math.max(0,energy-average-.06)*1.5;
  pulse=Math.max(pulse*Math.exp(-dt*8),Math.min(1,onset));previous=energy;
  return {bass:energy,beat:pulse};
}
