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
