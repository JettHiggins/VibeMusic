import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ClientMessage,ServerMessage,SessionCommand} from '../packages/contracts/src/index.ts';
const examples=JSON.parse(readFileSync('packages/contracts/fixtures/VoiceResearch.json','utf8'));
test('voice research context and preview examples validate in the correct direction',()=>{
 for(const message of examples){
  const client=message.type==='preview-ack';
  (client?ClientMessage:ServerMessage).parse(message);
  assert.equal((client?ServerMessage:ClientMessage).safeParse(message).success,false);
 }
});
test('research context binds a melodic track and cannot carry patches or extra fields',()=>{
 const context=examples.find((m:any)=>m.type==='research-context');
 for(const bad of [{trackId:'drums'},{origin:'model'},{requestId:''},{jobId:''},{description:''},{patch:{}},{previewUrl:'https://example.com/'}])
  assert.equal(ServerMessage.safeParse({...context,...bad}).success,false,JSON.stringify(bad));
 for(const key of ['requestId','jobId','trackId','description','origin']){
  const missing={...context};delete missing[key];assert.equal(ServerMessage.safeParse(missing).success,false,key);
 }
});
test('preview binds an exact candidate without model URLs, musical edits or scheduling',()=>{
 const preview=examples.find((m:any)=>m.type==='candidate-preview');
 for(const bad of [{id:''},{jobId:''},{candidateId:''},{previewUrl:'https://example.com/'},{patch:{}},{boundary:'next-loop'},{expectedRevision:1}])
  assert.equal(ServerMessage.safeParse({...preview,...bad}).success,false,JSON.stringify(bad));
 assert.equal(SessionCommand.safeParse({id:preview.id,expectedRevision:0,boundary:'immediate',operation:preview}).success,false);
});
test('preview acknowledgments are separate from musical mutation acknowledgments',()=>{
 const ack=examples.find((m:any)=>m.type==='preview-ack');
 for(const bad of [{id:''},{candidateId:''},{jobId:''},{status:'applied'},{status:'queued'},{revision:1},{reason:''}])
  assert.equal(ClientMessage.safeParse({...ack,...bad}).success,false,JSON.stringify(bad));
 for(const key of ['id','jobId','candidateId','status']){
  const missing={...ack};delete missing[key];assert.equal(ClientMessage.safeParse(missing).success,false,key);
 }
});
