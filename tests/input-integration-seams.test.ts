import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSession,ServerMessage,type ClientMessage,type Transport} from '../packages/contracts/src/index.ts';
import {displayedLane} from '../apps/web/src/ui/labels.ts';
import {handleSpeechMessage} from '../apps/web/src/input/speech-messages.ts';
test('completed take target does not override a newly selected drum lane',()=>{
 const session=createSession();session.selected={trackId:'drums',lane:'closed-hat'};
 const t:Transport={clockId:'clock',sampleRate:44100,currentFrame:600000,loopStartFrame:352800,playing:true,recording:false,recordingState:'idle',recordingStartFrame:352800,recordingTarget:{trackId:'drums',lane:'snare'},pendingCommandIds:[]};
 assert.equal(displayedLane(session,t),'closed-hat');
 assert.equal(displayedLane(session,{...t,recording:true,recordingState:'recording'}),'snare');
 assert.equal(displayedLane(session,{...t,recordingState:'armed',armedTarget:{trackId:'drums',lane:'kick'}}),'kick');
});
test('only explicit speech verification messages advance the recorder watermark',()=>{
 const calls:{clockId:string;frame:number}[]=[];
 const recorder={verifyThrough:(clockId:string,frame:number)=>{calls.push({clockId,frame});},addCommandSpan:()=>{}};
 handleSpeechMessage(recorder,{type:'command-span',utteranceId:'speech',clockId:'clock',startFrame:10,endFrame:20});
 assert.deepEqual(calls,[]);
 const message=ServerMessage.parse({type:'speech-verified',clockId:'clock',throughFrame:1000});
 handleSpeechMessage(recorder,message);assert.deepEqual(calls,[{clockId:'clock',frame:1000}]);
});
