import {ClientMessage,SessionCommand,createSession,type EngineAdapter,type SessionState} from '@voicesynth/contracts';
import {loadMetadata,type FirmwareMetadata} from './metadata.ts';
import {firmwareSnapshot} from './snapshot.ts';
export class BrowserEngine implements EngineAdapter {
 private session=createSession();
 private listeners=new Set<(m:ClientMessage)=>void>();
 private context:AudioContext|null=null;
 private node:AudioWorkletNode|null=null;
 private loading:Promise<void>|null=null;
 private disposed=false;
 metadata:FirmwareMetadata|null=null;
 onError:(error:Error)=>void=()=>{};
 constructor(session?:SessionState){if(session)this.session=structuredClone(session);}
 getSession(){return structuredClone(this.session);}
 subscribe(listener:(m:ClientMessage)=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
 initialize():Promise<void>{
  if(this.disposed)return Promise.reject(new Error('Engine disposed'));
  if(this.loading)return this.loading;
  if(this.node)return this.context!.resume();
  // Called by the user's activation gesture, before fetching or compiling.
  const context=this.context??=new AudioContext({sampleRate:44100,latencyHint:'interactive'});
  const resume=context.resume();
  this.loading=this.load(context,resume).finally(()=>{this.loading=null;});return this.loading;
 }
 private async load(context:AudioContext,resume:Promise<void>){
  try{
   await resume;if(context.sampleRate!==44100)throw new Error('SLOOP requires a 44.1 kHz AudioContext');
   const [metadata,response]=await Promise.all([loadMetadata(),fetch('/engine/voicesynth.wasm')]);
   if(!response.ok)throw new Error('Build SLOOP engine assets before enabling audio');
   firmwareSnapshot(this.session,metadata);
   const module=await WebAssembly.compile(await response.arrayBuffer());
   await context.audioWorklet.addModule('/engine-runtime.js');
   if(this.disposed)throw new Error('Engine disposed');
   this.metadata=metadata;
   const node=this.node=new AudioWorkletNode(context,'voicesynth-engine',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{module,metadata,session:this.session,clockId:crypto.randomUUID()}});
   let readyResolve:()=>void=()=>{};
   let readyReject:(error:Error)=>void=()=>{};
   const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
   const timeout=setTimeout(()=>readyReject(new Error('Audio worklet initialization timed out')),10000);
   node.port.onmessage=({data})=>{
    if(data.type==='engine-error'){const error=new Error(data.message);readyReject(error);this.onError(error);return;}
    const parsed=ClientMessage.safeParse(data);if(!parsed.success){this.onError(new Error('Invalid engine response'));return;}
    const message=parsed.data;if(message.type==='session'){this.session=message.session;readyResolve();}
    this.listeners.forEach(listener=>listener(message));
   };
   node.onprocessorerror=()=>{const error=new Error('Audio worklet stopped; reload the session to recover');readyReject(error);this.onError(error);};
   const gain=context.createGain();gain.gain.value=0.5;node.connect(gain).connect(context.destination);
   try{await ready;}finally{clearTimeout(timeout);}
  }catch(error){this.node?.disconnect();this.node=null;if(context.state!=='closed')await context.close();this.context=null;throw error;}
 }
 dispatch(input:SessionCommand):ClientMessage{
  const c=SessionCommand.parse(input);
  if(!this.node)return {type:'ack',commandId:c.id,status:'rejected',revision:this.session.revision,reason:'Enable audio first'};
  this.node.port.postMessage(c);
  // Submission receipt only; applied/rejected acknowledgments arrive from the audio thread.
  return {type:'ack',commandId:c.id,status:'queued',revision:this.session.revision};
 }
 dispose(){this.disposed=true;this.node?.disconnect();this.node=null;void this.context?.close();this.context=null;this.listeners.clear();}
}
