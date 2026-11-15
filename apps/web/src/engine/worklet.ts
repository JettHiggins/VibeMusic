// The build keeps this URL external; the generated upstream module is served unchanged.
// @ts-expect-error Upstream JavaScript is staged by the engine build.
import { FirmwareAudio } from '/engine/preview-worklet.js';
import { EngineCore } from './core.ts';
import type { FirmwareMetadata } from './metadata.ts';
import type { SessionState } from '@voicesynth/contracts';
declare const currentFrame: number;
declare class AudioWorkletProcessor { port: MessagePort; constructor(options: unknown); }
declare function registerProcessor(name:string,processor:typeof AudioWorkletProcessor):void;
class VoiceSynthProcessor extends AudioWorkletProcessor {
 private core!:EngineCore;
 private framesSinceReport=0;
 constructor(options:{processorOptions:{module:WebAssembly.Module;metadata:FirmwareMetadata;session:SessionState;clockId:string}}){
  super(options);const p=options.processorOptions;
  try{this.core=new EngineCore(new FirmwareAudio(p.module),p.metadata,p.session,p.clockId,m=>this.port.postMessage(m),currentFrame);}
  catch(error){this.port.postMessage({type:'engine-error',message:String(error)});return;}
  this.port.onmessage=({data})=>{try{if(data.type==='audition')this.core.audition(data.event);else this.core.dispatch(data);}catch(e){this.port.postMessage({type:'engine-error',message:String(e)});}};
  this.port.postMessage({type:'session',session:this.core.getSession()});
 }
 process(_inputs:Float32Array[][],outputs:Float32Array[][]){
  if(!this.core)return false;
  try{
   this.core.render(outputs[0][0],outputs[0][1],currentFrame);
   this.framesSinceReport+=outputs[0][0].length;
   if(this.framesSinceReport>=2048){this.port.postMessage({type:'transport',transport:this.core.transport()});this.framesSinceReport=0;}
  }catch(e){this.port.postMessage({type:'engine-error',message:String(e)});return false;}
  return true;
 }
}
registerProcessor('voicesynth-engine',VoiceSynthProcessor);
