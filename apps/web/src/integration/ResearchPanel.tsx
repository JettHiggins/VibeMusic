import React,{useEffect,useState,useSyncExternalStore} from 'react';
import type {SessionState} from '@voicesynth/contracts';
import type {ResearchController} from './research.ts';
export function ResearchPanel({controller,session,connected,enabled}:{controller:ResearchController;session:SessionState;connected:boolean;enabled:boolean}){
 const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
 const [description,setDescription]=useState('80s electric piano'),[error,setError]=useState<string|null>(null);
 useEffect(()=>{controller.setAudioEnabled(enabled);return()=>controller.setAudioEnabled(false);},[controller,enabled]);
 const attempt=(action:()=>void)=>{try{setError(null);action();}catch(e){setError(String(e));}};
 return <section aria-label="Sound research">
  <h2>Find a sound</h2>
  <form onSubmit={e=>{e.preventDefault();attempt(()=>controller.request(session.selected.trackId,description));}}>
   <label>Sound description <input value={description} onChange={e=>setDescription(e.target.value)} /></label>{' '}
   <button disabled={!connected||!enabled||session.selected.trackId==='drums'||state.acceptance?.status==='queued'}>Search selected synth</button>{' '}
   <button type="button" disabled={!connected||state.status!=='running'} onClick={()=>attempt(()=>controller.cancel())}>Cancel search</button>
  </form>
  <p>Search targets the selected synth. Edit the description and search again to explore another sound. Scores measure embedding similarity; judge the previews by ear.</p>
  {state.jobId&&<p>{state.description}</p>}
  <p role="status">{state.status}{state.trackId?` · ${state.trackId}`:''}{state.status==='running'?` · ${Math.round(state.progress*100)}%`:''}</p>
  {state.status==='running'&&<progress max={1} value={state.progress}/>}
  {(error||state.error)&&<p role="alert">{error||state.error}</p>}
  {state.candidates.map((candidate,i)=><article key={candidate.id} style={{border:'1px solid #8885',padding:12,margin:'8px 0'}}>
   <b>Candidate {i+1}</b> · score {candidate.score.toFixed(3)}
   <p>{candidate.provenance}</p>
   <button type="button" disabled={!enabled||!connected||!candidate.previewUrl} onClick={()=>attempt(()=>controller.preview(candidate.id))}>Preview candidate {i+1}</button>{' '}
   <button disabled={!enabled||state.acceptance?.status==='queued'} onClick={()=>attempt(()=>controller.accept(candidate.id))}>Use candidate {i+1}</button>
  </article>)}
  {state.preview&&<p role="status">Preview {state.preview.status}{state.preview.reason?`: ${state.preview.reason}`:''}. <button type="button" disabled={!['starting','playing'].includes(state.preview.status)} onClick={()=>controller.stopPreview()}>Stop preview</button></p>}
  {state.acceptance&&<p role="status">Sound change {state.acceptance.status}{state.acceptance.status==='queued'?' for the next loop':''}{state.acceptance.reason?`: ${state.acceptance.reason}`:''}. Undo restores the previous patch.</p>}
 </section>;
}
