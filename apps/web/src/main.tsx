import React, {useEffect,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createSession,type SessionCommand,type Transport} from '@voicesynth/contracts';
import {BrowserEngine} from './engine/browser.ts';
import {WebSocketAgent} from './integration/agent.ts';
import {SessionCoordinator} from './integration/coordinator.ts';
import {supportsBrowserActions} from './integration/browser-actions.ts';
import {VoiceInput} from './input/voice-input.ts';
import {ResearchController} from './integration/research.ts';
import {ResearchPanel} from './integration/ResearchPanel.tsx';
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
/**
 * Keeps hands-free listening alive (2026-11-15 playtest: "the agent disconnected and having to restart is
 * annoying"). When listening should be on but speech became unavailable (service restart, dropped socket,
 * a capture/coverage reset), restart hands-free with backoff 1, 2, 4 ... 10 s. A new connection starts
 * clean: nothing from the old one is replayed. Turning hands-free off by hand stops the watcher.
 */
class KeepListening{
 private wanted=false;private busy=false;private wait=1000;private next=0;
 constructor(private onMessage:(text:string)=>void){setInterval(()=>{void this.tick();},500);}
 start(){this.wanted=true;this.wait=1000;}
 private async tick(){
  const speech=voice.getState().speech;
  if(this.wanted&&!speech.enabled){this.wanted=false;return;} // the user switched hands-free off
  if(!this.wanted||this.busy||speech.status!=='unavailable'||Date.now()<this.next)return;
  this.busy=true;this.onMessage('Reconnecting to Groove…');
  try{await voice.enableHandsFree();}catch{/* reported by the voice state */}
  finally{
   this.busy=false;
   if(voice.getState().speech.status==='unavailable'){this.next=Date.now()+this.wait;this.wait=Math.min(10000,this.wait*2);}
   else{this.wait=1000;this.onMessage('Listening — say "Groove, …" to control the song.');}
  }
 }
}
// Development-only handle for driving the capture path with a test signal; absent from production builds.
if(import.meta.env.DEV)Object.assign(globalThis,{__voicesynth:{engine,voice,coordinator,research}});
let keepListening:KeepListening|null=null;
function App(){
 const researchState=useSyncExternalStore(research.subscribe,research.getSnapshot);
 const [session,setSession]=useState(engine.getSession());
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('Enable audio to start an empty four-bar project.');
 const [connected,setConnected]=useState(false),[text,setText]=useState('select snare');
 const [transport,setTransport]=useState<Transport|null>(null);
 useEffect(()=>{
  agent.onStatus=connected=>{setConnected(connected);coordinator.connectionChanged(connected);voice.setSpeechAvailable(connected);research.connectionChanged(connected);};
  agent.onError=e=>setMessage(e.message);
  coordinator.onError=e=>setMessage(e.message);
  coordinator.onMessage=m=>{voice.handleServerMessage(m);if(m.type==='error')setMessage(m.message);};
  keepListening??=new KeepListening(setMessage);
  engine.onError=e=>{setMessage(e.message);setBusy(false);};return engine.subscribe(m=>{
  if(m.type==='session')setSession(m.session);
  if(m.type==='transport')setTransport(m.transport);
  if(m.type==='ack'){setMessage(`${m.status}${m.reason?': '+m.reason:''}`);if(m.status!=='queued')setBusy(false);}
 });},[]);
 async function enable(){setBusy(true);try{await engine.initialize();setEnabled(true);research.setAudioEnabled(true);setMessage('SLOOP audio ready.');}catch(e){setMessage(String(e));setBusy(false);return;}finally{setBusy(false);}
  // Full voice control by default (2026-11-15 plan): this one click is the browser's required gesture,
  // so it also turns on the microphone and hands-free listening (which connects the local service).
  // Automated browser checks (navigator.webdriver) keep the manual flow so they can inject test audio.
  if(navigator.webdriver)return;
  try{await voice.enableMicrophone();}catch(e){setMessage(`Microphone: ${String(e)}`);return;}
  await voice.enableHandsFree();
  keepListening?.start();
  setMessage('Listening — say "Groove, …" to control the song.');
 }
 function command(operation:SessionCommand['operation'],boundary:SessionCommand['boundary']='immediate'){
  setBusy(true);try{const receipt=engine.dispatch({id:crypto.randomUUID(),expectedRevision:session.revision,boundary,operation});if(receipt.type==='ack'&&receipt.status==='rejected'){setBusy(false);setMessage(receipt.reason??'Rejected');}}catch(e){setBusy(false);setMessage(String(e));}
 }
 return <Groovebox engine={engine} voice={voice} session={session} transport={transport} enabled={enabled} busy={busy} message={message} onEnable={enable} dispatch={command}
  agentActivityKey={researchState.jobId} agent={<><section aria-label="Agent integration"><h2 style={{marginTop:0}}>Local command service</h2>
   <button disabled={connected} onClick={()=>{void agent.connect().catch(e=>setMessage(String(e)));}}>Connect agent</button>
   <p>{connected?'Agent connected':'Agent disconnected'}</p>
   <form onSubmit={e=>{e.preventDefault();try{coordinator.submitTranscript(text);}catch(error){setMessage(String(error));}}}>
    <label>Command transcript <input value={text} onChange={e=>setText(e.target.value)}/></label>{' '}
    <button disabled={!connected||!enabled||busy} type="submit">Send transcript</button>
   </form><p>This field tests transcript integration; it does not listen to your microphone.</p></section><ResearchPanel controller={research} session={session} connected={connected} enabled={enabled}/></>}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
if(import.meta.hot)import.meta.hot.dispose(()=>{
 research.dispose();coordinator.dispose();voice.dispose();agent.dispose();engine.dispose();
});
