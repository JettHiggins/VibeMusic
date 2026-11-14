import { SessionState } from '@voicesynth/contracts';
import type { FirmwareMetadata } from './metadata.ts';
export const ENGINE_REVISION = 'bac9c05ea7627449405aa10e48da21d75b6c8c56';
export const TRACK_IDS = ['synth-1','synth-2','synth-3','drums'] as const;
export const LANES = { kick: 0, snare: 2, 'closed-hat': 4 } as const;
function emptyStep() { return {notes:[0,0,0,0],n:0,time:2,flags:0,vel:0,lvl:0,rat:0}; }
/** Translate logical sessions to upstream FirmwareAudio.sync without mutating either input. */
export function firmwareSnapshot(input: SessionState, metadata: FirmwareMetadata) {
 const session=SessionState.parse(input);
 if(session.tracks.some((t,k)=>t.id!==TRACK_IDS[k]))throw new Error('Tracks must be in firmware slot order');
 if(session.selected.trackId!=='drums' && session.selected.lane)throw new Error('Only drum targets have lanes');
 const g=metadata.globals.map(p=>p.default);g[0]=session.tempo;g[1]=0;g[2]=0;g[13]=0;
 const tracks=session.tracks.map((track,k)=>{
  if(track.patch.engineRevision!==ENGINE_REVISION)throw new Error('Patch engine revision mismatch');
  const engine=metadata.engines[track.patch.engine];
  const preset=engine?.presets[track.patch.preset];
  if(!preset)throw new Error('Unknown engine or factory preset');
  const p=k===3?metadata.parameters.map(d=>d.default).concat([5,0,0,0,0,0,0,0]):preset.parameters.slice();
  for(const [key,value] of Object.entries(track.patch.parameters)){
   const id=Number(key);
   const descriptor=id<metadata.engineParamOffset?metadata.parameters[id]:engine.parameters[id-metadata.engineParamOffset];
   if(!/^\d+$/.test(key)||!descriptor||!Number.isInteger(value)||value<descriptor.min||value>descriptor.max)throw new Error(`Invalid patch parameter ${key}`);
   // Complete research patches may include these fields; session values override them.
   if([0,17,29,30,31,32,40].includes(id))continue;
   if(k===3)throw new Error('Custom drum patches require a drum-kit contract');
   p[id]=value;
  }
  // Pattern/mixer are session-owned; presets cannot silently enable an arpeggiator.
  p[0]=Math.round(track.volume*127);p[17]=0;p[29]=64;p[30]=2;p[31]=0;p[32]=127;p[40]=track.muted?1:0;
  const step=Array.from({length:64},emptyStep);
  const dstep=Array.from({length:64},()=>({on:0,lvl:Array(16).fill(0),rat:Array(16).fill(0)}));
  if(k===3 && track.notes.length)throw new Error('Drum tracks cannot contain melodic notes');
  if(k!==3 && track.hits.length)throw new Error('Melodic tracks cannot contain drum hits');
  const occupied=new Set<number>();
  for(const note of track.notes){
   if(note.velocity===0)continue;
   for(let offset=0;offset<note.duration;offset++){
    const i=(note.step+offset)%64;
    if(occupied.has(i))throw new Error('Overlapping monophonic notes');occupied.add(i);
    if(offset===0)Object.assign(step[i],{notes:[note.midi,0,0,0],n:1,time:0,vel:Math.round(note.velocity*127)});
    else step[i].time=1;
   }
  }
  const hitKeys=new Set<string>();
  for(const hit of track.hits){
   const key=`${hit.step}:${hit.lane}`;if(hitKeys.has(key))throw new Error('Duplicate drum grid position');hitKeys.add(key);
   const lane=LANES[hit.lane];if(hit.velocity===0)continue;
   dstep[hit.step].on|=1<<lane;
   // Firmware levels: 0 = normal (100), 1 = ghost (42), 2 = soft (72), 3 = hard (127).
   const velocity=Math.round(hit.velocity*127);
   dstep[hit.step].lvl[lane]=velocity<56?1:velocity<88?2:velocity<116?0:3;
  }
  const slot=p[metadata.engineParamOffset+7];
  const fm6=metadata.fm6Factory[slot] ?? metadata.fm6Factory[0];
  return {engine:track.patch.engine,preset:track.patch.preset,p,step,dstep,micro:Array(64).fill(0),fill:Array(16).fill(0),locks:[],fm6:fm6.slice()};
 });
 return {g,tracks,sel:TRACK_IDS.indexOf(session.selected.trackId),solo:0};
}
