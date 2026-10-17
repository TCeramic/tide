/** Transfer DOM state that HTML serialization does not include. No playback is started here. */
let tracked:HTMLElement[]=[];
export function tagThemeScene(): void {
 let id=0;const nodes=Array.from(document.querySelectorAll<HTMLElement>('#app *,#lyrics *, .native-popup-layer *'));nodes.forEach(el=>{el.dataset.revealNode=String(++id);});tracked=nodes.filter(el=>el.scrollTop>0||el.scrollLeft>0||el.matches('.lyric-list,.lyric-list li,.lyric-word,.word-mask,.word-hot,input,.home-card h2,.home-card p,.lyrics-title,.lyrics-artist'));
}
export function themeSceneState(){
 return tracked.filter(el=>el.isConnected).map(el=>({id:el.dataset.revealNode!,text:el.matches(".home-card h2,.home-card p,.lyrics-title,.lyrics-artist")?el.textContent:undefined,top:el.scrollTop,left:el.scrollLeft,classes:el.closest('.lyric-list')?el.className:undefined,style:el.closest('.lyric-list')?el.style.cssText:undefined,value:el instanceof HTMLInputElement?el.value:undefined}));
}
export function restoreThemeScene(state:ReturnType<typeof themeSceneState>){
 for(const item of state){const el=document.querySelector<HTMLElement>(`[data-reveal-node="${item.id}"]`);if(!el)continue;if(item.text!==undefined&&el.textContent!==item.text)el.textContent=item.text;el.scrollTop=item.top;el.scrollLeft=item.left;if(item.classes!==undefined)el.className=item.classes;if(item.style!==undefined)el.style.cssText=item.style;if(el instanceof HTMLInputElement&&item.value!==undefined)el.value=item.value;}
}
