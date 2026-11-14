import type {ClientMessage,ServerMessage,SpeechAudio} from '@voicesynth/contracts';
export interface SpeechSessionDeps {
 send(message:ClientMessage):void;
 available(value:boolean):void;
 verify(clockId:string,through:number):void;
 exclude(message:Extract<ServerMessage,{type:'command-span'}>):void;
 failed(reason:string):void;
}
/** One active contiguous stream. Availability is separate from both socket state and coverage. */
export class SpeechSession {
 private first:number|null=null;
 private end=0;
 private seq=0;
 private mark=-1;
 private broken=false;
 private ready=false;
 constructor(readonly streamId:string,readonly clockId:string,private deps:SpeechSessionDeps) {deps.available(false);}
 chunk(message:SpeechAudio) {
  if(this.broken)return;
  if(message.streamId!==this.streamId||message.clockId!==this.clockId||message.seq!==this.seq|| (this.first!==null&&message.startFrame!==this.end)){this.fail('Speech audio discontinuity; start a fresh stream/take');return;}
  this.first??=message.startFrame;this.end=message.endFrame;this.seq++;
  try{this.deps.send(message);}catch(error){this.fail(String(error));}
 }
 handle(message:ServerMessage) {
  if(this.broken)return;
  if(message.type==='speech-status'&&message.streamId===this.streamId){
   if(!message.available){this.fail(message.reason??'Speech recognition unavailable');return;}
   this.ready=true;this.deps.available(true);
  }
  if(message.type==='error'&&message.requestId===this.streamId)this.fail(message.message);
  if(message.type==='command-span'&&message.clockId===this.clockId&&this.first!==null&&message.startFrame>=this.first&&message.endFrame<this.end)this.deps.exclude(message);
  if(message.type==='speech-verified'){
   if(message.streamId!==this.streamId||message.clockId!==this.clockId)return;
   if(!this.ready||this.first===null||message.fromFrame!==this.first||message.throughFrame<this.first||message.throughFrame>=this.end){this.fail('Invalid speech coverage; a fresh stream/take is required');return;}
   if(message.throughFrame<=this.mark)return;
   this.mark=message.throughFrame;this.deps.verify(this.clockId,this.mark);
  }
 }
 fail(reason:string) {
  if(this.broken)return;
  this.broken=true;this.ready=false;this.deps.available(false);this.deps.failed(reason);
 }
}
