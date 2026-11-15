import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {z} from 'zod';
import {Patch,createSession} from '../packages/contracts/src/index.ts';
import {firmwareSnapshot} from '../apps/web/src/engine/snapshot.ts';
import type {FirmwareMetadata} from '../apps/web/src/engine/metadata.ts';
export const RenderRequest=z.strictObject({patch:Patch,recipe:z.strictObject({name:z.string().min(1),seconds:z.number().min(0.1).max(12),notes:z.array(z.tuple([z.number().nonnegative(),z.number().positive(),z.number().int().min(0).max(127),z.number().min(0).max(1)])).min(1).max(64)})});
export type RenderRequest=z.infer<typeof RenderRequest>;
/** Shared browser DSP, with native sample-timed note events; output is unnormalized mono float. */
export async function renderPatch(input:RenderRequest,assets=resolve('apps/web/public/engine')){
 const request=RenderRequest.parse(input);
 const metadata:FirmwareMetadata=JSON.parse(readFileSync(resolve(assets,'metadata.json'),'utf8'));
 const frames=Math.round(request.recipe.seconds*44100);
 const events:{frame:number;note:number;velocity:number;on:number}[]=[];
 for(const [start,duration,note,velocity] of request.recipe.notes){
  if(start+duration>request.recipe.seconds)throw new Error('Recipe note extends beyond render duration');
  if(velocity===0)continue;
  const onFrame=Math.round(start*44100),offFrame=Math.max(onFrame+1,Math.round((start+duration)*44100));
  if(offFrame>frames)throw new Error('Recipe note rounds beyond render duration');
  events.push({frame:onFrame,note,velocity:Math.max(1,Math.round(velocity*127)),on:1},{frame:offFrame,note,velocity:0,on:0});
 }
 // Release precedes retrigger when two events share a sample frame.
 events.sort((a,b)=>a.frame-b.frame||a.on-b.on);
 const session=createSession();session.tracks.forEach((t,k)=>{t.muted=k!==0;t.volume=0.7;});session.tracks[0].patch=request.patch;
 const snapshot=firmwareSnapshot(session,metadata);
 const module=await WebAssembly.compile(readFileSync(resolve(assets,'voicesynth.wasm')));
 const {FirmwareAudio}=await import(pathToFileURL(resolve(assets,'preview-worklet.js')).href);
 const dsp=new FirmwareAudio(module);dsp.sync(snapshot);
 if(typeof dsp.w.vs_note!=='function')throw new Error('Rebuild engine: offline note export is missing');
 const audio=new Float32Array(frames);
 let eventIndex=0;
 for(let frame=0;frame<frames;){
  while(eventIndex<events.length&&events[eventIndex].frame===frame){const e=events[eventIndex++];dsp.w.vs_note(0,e.note,e.velocity,e.on);}
  const next=events[eventIndex]?.frame??frames;
  const count=Math.min(metadata.blockFrames,frames-frame,next-frame);
  const pointer=dsp.w.vs_render(count);const stereo=new Float32Array(dsp.w.memory.buffer,pointer,count*2);
  for(let i=0;i<count;i++){const value=(stereo[i*2]+stereo[i*2+1])*0.5;if(!Number.isFinite(value))throw new Error('Non-finite engine render');audio[frame+i]=value;}
  frame+=count;
 }
 return audio;
}
