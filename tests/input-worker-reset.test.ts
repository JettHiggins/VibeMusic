import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {AnalysisRequest,AnalysisResult} from '../apps/web/src/input/analysis-worker.ts';

test('analysis worker honors reset cutoffs and keeps quiet singing out of the measured room floor',async()=>{
 const results:AnalysisResult[]=[];
 const scope={postMessage:(m:AnalysisResult)=>results.push(m),onmessage:null as ((e:{data:AnalysisRequest})=>void)|null};
 Object.assign(globalThis,{self:scope});
 await import('../apps/web/src/input/analysis-worker.ts');
 const port={onmessage:null as ((e:{data:{type:'audio';startFrame:number;samples:Float32Array}})=>void)|null};
 const send=(data:AnalysisRequest)=>scope.onmessage!({data});
 send({type:'connect',sampleRate:44100,port:port as unknown as MessagePort});
 const audio=(startFrame:number,length:number,tone=true)=>{
  const samples=Float32Array.from({length},(_,i)=>tone?.2*Math.sin(2*Math.PI*440*(startFrame+i)/44100):0);
  port.onmessage!({data:{type:'audio',startFrame,samples}});
 };
 for(let frame=0;frame<22050;frame+=1024)audio(frame,1024);
 assert.ok(results.some(m=>m.type==='onsets'&&m.pitch?.holding),'a sung note is held');
 results.length=0;
 send({type:'reset',frame:30000.25});
 audio(24000,1024);assert.equal(results.length,0,'queued old audio ignored');
 audio(29500,1024,false);
 const crossing=results.at(-1)!;
 assert.ok(crossing.type==='onsets'&&crossing.processedThrough===30524);
 send({type:'flush',frame:31000});
 assert.ok(results.every(m=>m.type!=='onsets'||m.notes.length===0),'pre-edit held note never flushes back');
 for(let frame=31000;frame<53000;frame+=1024)audio(frame,1024);
 send({type:'flush',frame:54000});
 const notes=results.flatMap(m=>m.type==='onsets'?m.notes:[]);
 assert.ok(notes.length>0,'fresh singing still detected');
 assert.ok(notes.every(n=>n.startFrame>=30001));

 // A quiet but clearly pitched voice is foreground, even when the current gate labels it quiet.
 send({type:'configure',noiseFloorDb:-40});
 send({type:'measure-noise',frames:Math.round(1.5*44100)});
 results.length=0;
 let cursor=53528;
 const voiceEnd=cursor+44100;
 while(cursor<voiceEnd){
  const samples=Float32Array.from({length:1024},(_,i)=>10**(-30/20)*Math.SQRT2*Math.sin(2*Math.PI*220*(cursor+i)/44100));
  port.onmessage!({data:{type:'audio',startFrame:cursor,samples}});cursor+=samples.length;
 }
 let seed=17;
 while(cursor<voiceEnd+120000&&!results.some(m=>m.type==='noise-floor')){
  const samples=Float32Array.from({length:1024},()=>{seed=(seed*1664525+1013904223)>>>0;return ((seed/4294967296)*2-1)*10**(-45/20)*Math.sqrt(3);});
  port.onmessage!({data:{type:'audio',startFrame:cursor,samples}});cursor+=samples.length;
 }
 const floor=results.find(m=>m.type==='noise-floor');
 assert.ok(floor?.type==='noise-floor', 'calibration completes after enough non-voiced room frames arrive');
 assert.ok(floor.db>-48&&floor.db<-42, `quiet singing must not raise the room floor; got ${floor.db.toFixed(1)} dBFS`);

 // Continuous singing is real capture, but is not a valid room-noise sample. It must fail with
 // an insufficient-quiet result rather than looking like the microphone stopped producing audio.
 results.length=0;
 send({type:'measure-noise',frames:Math.round(1.5*44100)});
 const singingEnd=cursor+6*44100;
 while(cursor<singingEnd){
  const samples=Float32Array.from({length:1024},(_,i)=>10**(-20/20)*Math.SQRT2*Math.sin(2*Math.PI*220*(cursor+i)/44100));
  port.onmessage!({data:{type:'audio',startFrame:cursor,samples}});cursor+=samples.length;
 }
 assert.ok(results.some(m=>m.type==='noise-floor-unavailable'&&/Not enough quiet audio/.test(m.message)), 'continuous foreground voice gets a distinct insufficient-quiet result');
 assert.ok(!results.some(m=>m.type==='error'&&/No microphone audio arrived/.test(m.message)), 'active capture must not be described as a missing microphone');
});
