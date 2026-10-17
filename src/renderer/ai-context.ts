import type { AiInput } from "../core/ai-assist";
import type { Track } from "../core/playback/types";
let track:Track|null=null,lines:string[]=[];
export function setAiTrack(value:Track|null){if(track?.id!==value?.id)lines=[];track=value;}
export function setAiLines(value:string[]){lines=value;}
export function aiContext(task:"theme"|"segment"):AiInput{return {task,title:track?.title??"",lines};}
export function aiCover(){return track?.cover;}
export function aiTrackId(){return track?.id??"";}
