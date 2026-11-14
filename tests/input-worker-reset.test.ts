import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {AnalysisRequest,AnalysisResult} from '../apps/web/src/input/analysis-worker.ts';

test('real analysis worker reset drops held pitch, trims crossing chunks and ignores queued pre-cutoff audio',async()=>{
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
});
