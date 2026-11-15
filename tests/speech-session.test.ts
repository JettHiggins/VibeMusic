import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SpeechSession} from '../apps/web/src/input/speech-session.ts';
const setup=(streamId='s')=>{
 const sent:any[]=[],verified:number[]=[],spans:any[]=[],available:boolean[]=[],failures:string[]=[];
 const session=new SpeechSession(streamId,'clock',{send:m=>{sent.push(m);},verify:(_c,f)=>verified.push(f),available:a=>available.push(a),exclude:m=>spans.push(m),failed:r=>failures.push(r)});
 const chunk=(startFrame=100,endFrame=200,seq=0)=>session.chunk({type:'speech-audio',streamId,clockId:'clock',startFrame,endFrame,seq,sampleRate:44100,encoding:'pcm-s16le',data:'AAAA'});
 const ready=()=>session.handle({type:'speech-status',streamId,available:true,provider:'SCRIPTED'});
 const mark=(throughFrame:number,fromFrame=100,stream=streamId)=>session.handle({type:'speech-verified',streamId:stream,clockId:'clock',fromFrame,throughFrame});
 return {session,sent,verified,spans,available,failures,chunk,ready,mark};
};
test('socket/audio alone never enables commits, active scoped coverage stays within sent frames',()=>{
 const s=setup();s.chunk();assert.deepEqual(s.available,[false]);s.ready();s.mark(150);s.mark(140);
 assert.deepEqual(s.verified,[150]);s.mark(180,100,'old');assert.deepEqual(s.verified,[150]);
 s.session.handle({type:'speech-verified',clockId:'clock',throughFrame:190});assert.deepEqual(s.verified,[150],'legacy unscoped producer cannot verify this stream');
 s.mark(200);assert.equal(s.failures.length,1);assert.equal(s.available.at(-1),false);s.mark(199);assert.deepEqual(s.verified,[150]);
});
test('same-clock gap then new quiet stream cannot verify pre-gap pending input',()=>{
 const old=setup();old.chunk();old.ready();old.mark(150);old.chunk(300,400,1);
 assert.equal(old.failures.length,1);assert.equal(old.sent.length,1);
 const fresh=setup('new');fresh.chunk(500,600);fresh.ready();fresh.mark(550,100);
 assert.equal(fresh.failures.length,1);assert.equal(fresh.verified.length,0,'new stream cannot claim old interval');
 const valid=setup('newer');valid.chunk(500,600);valid.ready();valid.mark(550,500);assert.deepEqual(valid.verified,[550]);
});
test('unavailable is terminal and never silently falls back or replays queued audio',()=>{
 const s=setup();s.chunk();s.session.handle({type:'speech-status',streamId:'s',available:false,provider:'none'});
 s.ready();s.mark(180);s.chunk(200,300,1);assert.equal(s.sent.length,1);assert.equal(s.verified.length,0);assert.equal(s.failures.length,1);assert.equal(s.available.at(-1),false);
});

test('connected recognizer that stops classifying hits the clock-based deadline and cannot recover silently',()=>{
 const sent:any[]=[],lag:number[]=[],failed:string[]=[],available:boolean[]=[];
 const session=new SpeechSession('s','clock',{send:m=>sent.push(m),available:a=>available.push(a),verify:()=>{},exclude:()=>{},failed:r=>failed.push(r),lag:s=>lag.push(s)},44100);
 session.handle({type:'speech-status',streamId:'s',available:true,provider:'SCRIPTED stalled recognizer'});
 for(let i=0;i<82;i++)session.chunk({type:'speech-audio',streamId:'s',clockId:'clock',seq:i,startFrame:100000+i*4410,endFrame:100000+(i+1)*4410,sampleRate:44100,encoding:'pcm-s16le',data:'AAAA'});
 assert.equal(failed.length,1);assert.match(failed[0],/stalled/);assert.equal(sent.length,80,'no more than eight seconds of unverified audio sent');
 assert.ok(lag.some(s=>s>2));assert.equal(available.at(-1),false);
 session.handle({type:'speech-status',streamId:'s',available:true,provider:'SCRIPTED'});assert.equal(available.at(-1),false);
});

test('advancing coverage reduces backlog; a normal long classification segment remains usable',()=>{
 const lag:number[]=[],failed:string[]=[];
 const session=new SpeechSession('s','clock',{send:()=>{},available:()=>{},verify:()=>{},exclude:()=>{},failed:r=>failed.push(r),lag:s=>lag.push(s)},44100);
 session.handle({type:'speech-status',streamId:'s',available:true,provider:'SCRIPTED'});
 for(let i=0;i<100;i++){
  session.chunk({type:'speech-audio',streamId:'s',clockId:'clock',seq:i,startFrame:i*4410,endFrame:(i+1)*4410,sampleRate:44100,encoding:'pcm-s16le',data:'AAAA'});
  if(i%40===39)session.handle({type:'speech-verified',streamId:'s',clockId:'clock',fromFrame:0,throughFrame:(i+1)*4410-1});
 }
 assert.deepEqual(failed,[]);assert.ok(lag.includes(0));assert.ok(Math.max(...lag)<=4);
});
