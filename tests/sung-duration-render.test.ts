import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSession} from '../packages/contracts/src/index.ts';
import {EngineCore} from '../apps/web/src/engine/core.ts';
const dir='apps/web/public/engine',SR=44100;
const rms=(samples:Float32Array,start:number,end:number)=>{let sum=0;const a=Math.round(start*SR),b=Math.round(end*SR);for(let i=a;i<b;i++)sum+=samples[i]*samples[i];return Math.sqrt(sum/(b-a));};
test('the real synth sustains a full-bar note gate, unlike a short note with the same envelope',{skip:!existsSync(`${dir}/voicesynth.wasm`)},async()=>{
 const {FirmwareAudio}=await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const wasm=await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`));
 const metadata=JSON.parse(readFileSync(`${dir}/metadata.json`,'utf8'));
 const render=(duration:number,step=0,seconds=3)=>{
  const state=createSession();
  // Known gated sustain/release envelope. Natural pluck decay is a separate patch property.
  state.tracks[0].patch={...state.tracks[0].patch,engine:0,preset:2,parameters:{'1':0,'2':20,'3':110,'4':0}};
  state.tracks[0].notes=[{id:'sung',step,duration,midi:60,velocity:.8}];
  const core=new EngineCore(new FirmwareAudio(wasm),metadata,state,'clock',()=>{});
  core.dispatch({id:'click-off',expectedRevision:0,boundary:'immediate',operation:{type:'metronome',enabled:false}});
  core.dispatch({id:'play',expectedRevision:core.getSession().revision,boundary:'immediate',operation:{type:'play',playing:true}});
  const audio=new Float32Array(seconds*SR);core.render(audio,new Float32Array(audio.length),0);
  assert.equal(core.getSession().tracks[0].notes[0].duration,duration,'the engine preserves the recorded gate');
  return audio;
 };
 const held=render(16),short=render(2);
 const heldLate=rms(held,1.65,1.85),shortLate=rms(short,1.65,1.85),released=rms(held,2.65,2.85);
 assert.ok(heldLate>1e-4,`late held sound must be audible in DSP output: ${heldLate}`);
 assert.ok(heldLate>shortLate*10,`long vs short gate: ${heldLate} / ${shortLate}`);
 assert.ok(heldLate>released*10,`actual note-off releases the sound: ${heldLate} / ${released}`);
 const crossing=render(16,60,11),acrossLoop=rms(crossing,8.6,8.8),afterCrossing=rms(crossing,10.5,10.7);
 assert.ok(acrossLoop>1e-4,'the tied note must keep sounding after the four-bar loop wraps');
 assert.ok(acrossLoop>afterCrossing*10,'the wrap must not leave a stuck note after its actual end');
});
