import React, {useEffect,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createSession,type SessionCommand,type Transport} from '@voicesynth/contracts';
import {BrowserEngine} from './engine/browser.ts';
import {WebSocketAgent} from './integration/agent.ts';
import {SessionCoordinator} from './integration/coordinator.ts';
import {supportsBrowserActions} from './integration/browser-actions.ts';
import {VoiceInput} from './input/voice-input.ts';
import {ResearchController} from './integration/research.ts';
import {ResearchPanel, ResearchProgress} from './integration/ResearchPanel.tsx';
import {updateHeardSpeech,type HeardSpeech} from './ui/voice-feedback.ts';
import {Groovebox} from './ui/Groovebox.tsx';
const initialSession=createSession();
// Keep the existing first synth's default voice, but never seed a song on launch.
initialSession.tracks[0].patch.engine=1;
const engine=new BrowserEngine(initialSession);
const agent=new WebSocketAgent();
const voice=new VoiceInput(engine);
const coordinator=new SessionCoordinator(engine,agent,()=>agent.connected);
if(supportsBrowserActions(voice))coordinator.setBrowserActionAdapter(voice);
voice.configureSpeechSender(message=>agent.send(message),()=>agent.disconnect(),()=>agent.connect());
const research=new ResearchController(engine,agent,()=>agent.connected);
coordinator.prepareCommand=command=>research.prepareCommand(voice.prepareCommand(command));
coordinator.onReceipt=message=>research.commandReceipt(message);
// Development-only handle for driving the capture path with a test signal; absent from production builds.
if(import.meta.env.DEV)Object.assign(globalThis,{__voicesynth:{engine,voice,coordinator,research}});
function App(){
 const researchState=useSyncExternalStore(research.subscribe,research.getSnapshot);
 const [session,setSession]=useState(engine.getSession());
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [connected,setConnected]=useState(false);
 const [heardSpeech,setHeardSpeech]=useState<HeardSpeech|null>(null);
 const [transport,setTransport]=useState<Transport|null>(null);
 useEffect(()=>{
  agent.onStatus=connected=>{setConnected(connected);if(!connected)setHeardSpeech(null);coordinator.connectionChanged(connected);voice.setSpeechAvailable(connected);research.connectionChanged(connected);};
  agent.onError=e=>setMessage(e.message);
  coordinator.onError=e=>setMessage(e.message);
  coordinator.onMessage=m=>{voice.handleServerMessage(m);if(['speech-transcript','command','browser-action','candidate-preview','research-context','error'].includes(m.type))setHeardSpeech(previous=>updateHeardSpeech(previous,m));if(m.type==='error')setMessage(m.message);};
  engine.onError=e=>{setMessage(e.message);setBusy(false);};return engine.subscribe(m=>{
  if(m.type==='session')setSession(m.session);
  if(m.type==='transport')setTransport(m.transport);
  if(m.type==='ack'){setMessage(`${m.status}${m.reason?': '+m.reason:''}`);if(m.status!=='queued')setBusy(false);}
 });},[]);
 async function enable(){setBusy(true);try{await engine.initialize();setEnabled(true);research.setAudioEnabled(true);setMessage('SLOOP audio ready.');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 function command(operation:SessionCommand['operation'],boundary:SessionCommand['boundary']='immediate'){
  setBusy(true);try{const receipt=engine.dispatch({id:crypto.randomUUID(),expectedRevision:session.revision,boundary,operation});if(receipt.type==='ack'&&receipt.status==='rejected'){setBusy(false);setMessage(receipt.reason??'Rejected');}}catch(e){setBusy(false);setMessage(String(e));}
 }
 return <Groovebox engine={engine} voice={voice} session={session} transport={transport} enabled={enabled} busy={busy} message={message} onEnable={enable} dispatch={command}
  heardSpeech={heardSpeech} activity={<ResearchProgress state={researchState} onCancel={()=>research.cancel()}/>} agentActivityKey={researchState.jobId} agent={<ResearchPanel controller={research} session={session} connected={connected} enabled={enabled} connect={()=>agent.connect()}/>}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
if(import.meta.hot)import.meta.hot.dispose(()=>{
 research.dispose();coordinator.dispose();voice.dispose();agent.dispose();engine.dispose();
});
