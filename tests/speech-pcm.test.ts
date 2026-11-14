import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SpeechPcmEncoder} from '../apps/web/src/input/speech-pcm.ts';
import {SpeechAudio,type SpeechAudio as Audio} from '../packages/contracts/src/index.ts';
const setup=(latencyFrames=0)=>{
 const chunks:Audio[]=[];
 const encoder=new SpeechPcmEncoder({streamId:'stream',clockId:'clock',sampleRate:44100,latencyFrames},m=>{SpeechAudio.parse(m);chunks.push(m);});
 return {encoder,chunks};
};
test('speech PCM includes silence, stays contiguous and preserves exact clock coverage over uneven input blocks',()=>{
 const {encoder,chunks}=setup(123);
 for(let start=0;start<44100;start+=1024)encoder.push(start,new Float32Array(Math.min(1024,44100-start)));
 encoder.flush();
 assert.equal(chunks[0].startFrame,0);assert.equal(chunks.at(-1)!.endFrame,44100-123);
 chunks.forEach((m,i)=>{assert.equal(m.seq,i);assert.equal(m.sampleRate,44100);assert.equal(atob(m.data).length,2*(m.endFrame-m.startFrame));assert.ok(m.endFrame-m.startFrame<=4410);if(i)assert.equal(m.startFrame,chunks[i-1].endFrame);});
});
test('negative startup correction trims corresponding PCM and quantizes latency exactly as musical capture',()=>{
 for(const latency of [2,2.5,2.6]){
  const {encoder,chunks}=setup(latency);
  encoder.push(0,Float32Array.from([-.8,-.6,-.4,-.2,0,.2,.4,.6]));encoder.flush();
  const cut=-Math.round(-latency),m=chunks[0],binary=Uint8Array.from(atob(m.data),c=>c.charCodeAt(0));
  assert.equal(m.startFrame,Math.max(0,Math.round(cut-latency)));assert.equal(m.endFrame,Math.round(8-latency));
  const first=new DataView(binary.buffer).getInt16(0,true);
  assert.equal(first,Math.round([-.8,-.6,-.4,-.2,0,.2,.4,.6][cut]*32768));
 }
});
test('gaps discard buffered audio and cannot replay it on a restarted stream',()=>{
 const {encoder,chunks}=setup();encoder.push(100,new Float32Array(100));
 assert.throws(()=>encoder.push(201,new Float32Array(100)),/gap/);
 encoder.flush();encoder.push(301,new Float32Array(4410));assert.equal(chunks.length,0);
 const fresh=setup();fresh.encoder.push(301,new Float32Array(4410));assert.equal(fresh.chunks[0].seq,0);assert.equal(fresh.chunks[0].startFrame,301);
});
