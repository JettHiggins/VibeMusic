import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ClientMessage,ServerMessage,SessionCommand,MockEngine} from '../packages/contracts/src/index.ts';
const examples=JSON.parse(readFileSync('packages/contracts/fixtures/PlaytestRepair.json','utf8'));
test('playtest repair examples parse in the proper direction, retaining old transport shape',()=>{
 for(const message of examples)(message.type==='transport'?ClientMessage:ServerMessage).parse(message);
 ClientMessage.parse({type:'transport',transport:{clockId:'old',sampleRate:44100,currentFrame:0,loopStartFrame:0,playing:false,recording:false,pendingCommandIds:[]}});
});
test('erase addresses only one grid position; arbitrary patterns and invalid steps reject',()=>{
 const command=examples[1].command;
 for(const bad of [{step:-1},{step:64},{step:0.5},{notes:[]},{hits:[]},{throughFrame:99}])assert.equal(SessionCommand.safeParse({...command,operation:{...command.operation,...bad}}).success,false);
 assert.equal(SessionCommand.safeParse({...command,operation:{...command.operation,target:{trackId:'synth-4'}}}).success,false);
});
test('metronome does not accept a pattern or gain mutation',()=>{
 const command=examples[0].command;
 for(const bad of [{enabled:1},{enabled:'on'},{volume:1},{patch:{}}])assert.equal(SessionCommand.safeParse({...command,operation:{...command.operation,...bad}}).success,false);
});
test('capture erasure is scoped to a command, epoch, clock transport and finite grid cutoff',()=>{
 const message=examples[4];
 for(const bad of [{throughFrame:-1},{recordingEpoch:-1},{commandId:''},{step:64},{cutoff:10}])assert.equal(ClientMessage.safeParse({...message,transport:{...message.transport,captureErasure:{...message.transport.captureErasure,...bad}}}).success,false);
 for(const count of [-1,5,1.5])assert.equal(ClientMessage.safeParse({...examples[3],transport:{...examples[3].transport,countInBeatsRemaining:count}}).success,false);
 const mock=new MockEngine(),before=mock.getSession();const receipt=mock.dispatch(examples[1].command);assert.ok(receipt.type==='ack'&&receipt.status==='rejected');assert.deepEqual(mock.getSession(),before);
});
