import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createSession,type SessionCommand,type Transport} from '@voicesynth/contracts';
import {BrowserEngine} from './engine/browser.ts';
import {WebSocketAgent} from './integration/agent.ts';
import {SessionCoordinator} from './integration/coordinator.ts';
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
function App(){
 const [session,setSession]=useState(engine.getSession());
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('Enable audio to load the four-bar demo.');
 const [connected,setConnected]=useState(false),[text,setText]=useState('select snare');
 const [transport,setTransport]=useState<Transport|null>(null);
 useEffect(()=>{
  agent.onStatus=connected=>{setConnected(connected);if(connected)coordinator.sync();};
  agent.onError=e=>setMessage(e.message);
  coordinator.onError=e=>setMessage(e.message);
  coordinator.onMessage=m=>{if(m.type==='error')setMessage(m.message);};
  engine.onError=e=>{setMessage(e.message);setBusy(false);};return engine.subscribe(m=>{
  if(m.type==='session')setSession(m.session);
  if(m.type==='transport')setTransport(m.transport);
  if(m.type==='ack'){setMessage(`${m.status}${m.reason?': '+m.reason:''}`);if(m.status!=='queued')setBusy(false);}
 });},[]);
 async function enable(){setBusy(true);try{await engine.initialize();setEnabled(true);setMessage('SLOOP audio ready.');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 function command(operation:SessionCommand['operation'],boundary:SessionCommand['boundary']='immediate'){
  setBusy(true);try{const receipt=engine.dispatch({id:crypto.randomUUID(),expectedRevision:session.revision,boundary,operation});if(receipt.type==='ack'&&receipt.status==='rejected'){setBusy(false);setMessage(receipt.reason??'Rejected');}}catch(e){setBusy(false);setMessage(String(e));}
 }
 return <main style={{maxWidth:800,margin:'4rem auto',fontFamily:'system-ui',padding:24}}>
  <h1>VoiceSynthesizer</h1><p>SLOOP browser engine integration • four bars • {session.tempo} BPM</p>
  <p>Real firmware audio. Transcript commands connect to the local service. Microphone recognition and sound research are not connected yet.</p>
  <button disabled={enabled||busy} onClick={enable}>Enable audio</button>{' '}
  <button disabled={!enabled||busy} onClick={()=>command({type:'play',playing:true})}>Play demo</button>{' '}
  <button disabled={!enabled} onClick={()=>command({type:'play',playing:false})}>Stop playback</button>
  <p role="status">{message}</p><p>{transport?.playing?'Playing':'Stopped'} · queued edits: {transport?.pendingCommandIds.length??0}</p>
  <p>Selected: {session.selected.trackId}</p>
  {session.tracks.map(track=><button disabled={!enabled||busy} key={track.id} onClick={()=>command({type:'select',target:track.id==='drums'?{trackId:'drums',lane:'kick'}:{trackId:track.id}})}>{track.name}</button>)}
  <p><button disabled={!enabled||busy} onClick={()=>command({type:'tempo',bpm:session.tempo===120?137:120},'next-loop')}>Change tempo next loop</button>{' '}
  <button disabled={!enabled||busy} onClick={()=>command({type:'clear',target:session.selected},'next-loop')}>Clear selected next loop</button>{' '}
  <button disabled={!enabled||busy} onClick={()=>command({type:'undo'},'next-loop')}>Undo next loop</button></p>
 <section aria-label="Agent integration"><h2>Local command service</h2>
  <button disabled={connected} onClick={()=>{void agent.connect().catch(e=>setMessage(String(e)));}}>Connect agent</button>
  <p>{connected?'Agent connected':'Agent disconnected'}</p>
  <form onSubmit={e=>{e.preventDefault();try{coordinator.submitTranscript(text);}catch(error){setMessage(String(error));}}}>
   <label>Command transcript <input value={text} onChange={e=>setText(e.target.value)}/></label>{' '}
   <button disabled={!connected||!enabled||busy} type="submit">Send transcript</button>
  </form><p>This field tests transcript integration; it does not listen to your microphone.</p></section>
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
