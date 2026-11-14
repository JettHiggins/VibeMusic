import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createSession,type SessionCommand,type Transport} from '@voicesynth/contracts';
import {BrowserEngine} from './engine/browser.ts';
import {WebSocketAgent} from './integration/agent.ts';
import {SessionCoordinator} from './integration/coordinator.ts';
import {VoiceInput} from './input/voice-input.ts';
import {ResearchController} from './integration/research.ts';
import {ResearchPanel} from './integration/ResearchPanel.tsx';
import {Groovebox} from './ui/Groovebox.tsx';
const demo=createSession();
demo.tracks[0].patch.engine=1;
for(let bar=0;bar<4;bar++){
 for(const step of [0,8])demo.tracks[3].hits.push({id:`kick-${bar}-${step}`,step:bar*16+step,lane:'kick',velocity:0.9});
 for(const step of [4,12])demo.tracks[3].hits.push({id:`snare-${bar}-${step}`,step:bar*16+step,lane:'snare',velocity:0.8});
 for(let step=0;step<16;step+=2)demo.tracks[3].hits.push({id:`hat-${bar}-${step}`,step:bar*16+step,lane:'closed-hat',velocity:0.5});
 demo.tracks[0].notes.push({id:`note-${bar}`,step:bar*16,duration:8,midi:[60,64,67,64][bar],velocity:0.7});
}
const engine=new BrowserEngine(demo);
const agent=new WebSocketAgent();
const coordinator=new SessionCoordinator(engine,agent,()=>agent.connected);
const voice=new VoiceInput(engine);
voice.configureSpeechSender(message=>agent.send(message));
coordinator.prepareCommand=command=>voice.prepareCommand(command);
const research=new ResearchController(engine,agent,()=>agent.connected);
// Development-only handle for driving the capture path with a test signal; absent from production builds.
if(import.meta.env.DEV)Object.assign(globalThis,{__voicesynth:{engine,voice,coordinator}});
function App(){
 const [session,setSession]=useState(engine.getSession());
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('Enable audio to load the four-bar demo.');
 const [connected,setConnected]=useState(false),[text,setText]=useState('select snare');
 const [transport,setTransport]=useState<Transport|null>(null);
 useEffect(()=>{
  agent.onStatus=connected=>{setConnected(connected);coordinator.connectionChanged(connected);voice.setSpeechAvailable(connected);research.connectionChanged(connected);};
  agent.onError=e=>setMessage(e.message);
  coordinator.onError=e=>setMessage(e.message);
  coordinator.onMessage=m=>{voice.handleServerMessage(m);if(m.type==='error')setMessage(m.message);};
  engine.onError=e=>{setMessage(e.message);setBusy(false);};return engine.subscribe(m=>{
  if(m.type==='session')setSession(m.session);
  if(m.type==='transport')setTransport(m.transport);
  if(m.type==='ack'){setMessage(`${m.status}${m.reason?': '+m.reason:''}`);if(m.status!=='queued')setBusy(false);}
 });},[]);
 async function enable(){setBusy(true);try{await engine.initialize();setEnabled(true);setMessage('SLOOP audio ready.');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 function command(operation:SessionCommand['operation'],boundary:SessionCommand['boundary']='immediate'){
  setBusy(true);try{const receipt=engine.dispatch({id:crypto.randomUUID(),expectedRevision:session.revision,boundary,operation});if(receipt.type==='ack'&&receipt.status==='rejected'){setBusy(false);setMessage(receipt.reason??'Rejected');}}catch(e){setBusy(false);setMessage(String(e));}
 }
 return <Groovebox engine={engine} voice={voice} session={session} transport={transport} enabled={enabled} busy={busy} message={message} onEnable={enable} dispatch={command}
  agent={<><section aria-label="Agent integration"><h2 style={{marginTop:0}}>Local command service</h2>
   <button disabled={connected} onClick={()=>{void agent.connect().catch(e=>setMessage(String(e)));}}>Connect agent</button>
   <p>{connected?'Agent connected':'Agent disconnected'}</p>
   <form onSubmit={e=>{e.preventDefault();try{coordinator.submitTranscript(text);}catch(error){setMessage(String(error));}}}>
    <label>Command transcript <input value={text} onChange={e=>setText(e.target.value)}/></label>{' '}
    <button disabled={!connected||!enabled||busy} type="submit">Send transcript</button>
   </form><p>This field tests transcript integration; it does not listen to your microphone.</p></section><ResearchPanel controller={research} session={session} connected={connected} enabled={enabled}/></>}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
if(import.meta.hot)import.meta.hot.dispose(()=>{
 research.dispose();voice.dispose();coordinator.dispose();agent.dispose();engine.dispose();
});
