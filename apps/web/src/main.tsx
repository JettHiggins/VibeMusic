import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MockEngine } from '@voicesynth/contracts';
const engine = new MockEngine();
function App() {
 const [session,setSession]=useState(engine.getSession());
 return <main style={{maxWidth:800,margin:'4rem auto',fontFamily:'system-ui',padding:24}}><h1>VoiceSynthesizer</h1><p>Milestone 0 — contract demonstration. No audio or AI is connected.</p><p>4 bars · {session.tempo} BPM · selected: {session.selected.trackId}</p>{session.tracks.map(track=><button key={track.id} onClick={()=>{engine.dispatch({id:crypto.randomUUID(),expectedRevision:session.revision,boundary:'immediate',operation:{type:'select',target:{trackId:track.id}}});setSession(engine.getSession());}}>{track.name}</button>)}</main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
