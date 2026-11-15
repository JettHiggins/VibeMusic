import {writeFileSync} from 'node:fs';
import {createSession} from '../packages/contracts/src/index.ts';
const session=createSession();
const command={id:'select-kick-1',expectedRevision:0,boundary:'immediate',operation:{type:'select',target:{trackId:'drums',lane:'kick'}}};
const examples={SessionState:session,SessionCommand:command,PerformanceEvent:{id:'hit-1',kind:'onset',target:{trackId:'drums',lane:'kick'},clockId:'audio-1',captureFrame:48000,confidence:0.95,velocity:0.8},PatchCandidate:{id:'patch-1',patch:session.tracks[0].patch,provenance:'fixture only; not a researched patch',previewUrl:'',score:0},ClientMessage:{type:'session',session},ServerMessage:{type:'command',command}};
for(const [name,value] of Object.entries(examples))writeFileSync(`packages/contracts/fixtures/${name}.json`,JSON.stringify(value,null,2)+'\n');
