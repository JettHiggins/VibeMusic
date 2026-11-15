import type { SpeechAudio } from '@voicesynth/contracts';
import { SpeechPcmEncoder } from './speech-pcm.ts';
export type SpeechRequest = {type:'connect';port:MessagePort;streamId:string;clockId:string;sampleRate:number;latencyFrames:number} | {type:'flush'};
export type SpeechResult = {type:'chunk';message:SpeechAudio} | {type:'gap';streamId:string;reason:string};
const scope=self as unknown as {onmessage:((event:MessageEvent<SpeechRequest>)=>void)|null;postMessage(message:SpeechResult):void};
let encoder:SpeechPcmEncoder|null=null,port:MessagePort|null=null;
scope.onmessage=({data})=>{
 if(data.type==='flush'){encoder?.flush();return;}
 port?.close(); encoder?.fail(); encoder=null;
 const streamId=data.streamId;
 let failed=false;
 let current:SpeechPcmEncoder|null=null;
 const fail=(reason:string)=>{if(failed)return;failed=true;current?.fail();scope.postMessage({type:'gap',streamId,reason});};
 try{encoder=current=new SpeechPcmEncoder(data,message=>scope.postMessage({type:'chunk',message}));}
 catch(error){fail(String(error));return;}
 port=data.port;
 port.onmessage=({data:audio})=>{
  if(failed||encoder!==current)return;
  if(audio.type==='gap'){fail('Microphone capture discontinuity; restart speech capture');return;}
  if(audio.type==='audio')try{current!.push(audio.startFrame,audio.samples);}catch(error){fail(String(error));}
 };
};
