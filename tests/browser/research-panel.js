// UI fixture test; the live research integration test separately verifies actual SLOOP preview retrieval.
async page => {
 return await page.evaluate(async()=>{
  const reactModule=await import('/node_modules/.vite/deps/react.js'),React=reactModule.default??reactModule;
  const dom=await import('/node_modules/.vite/deps/react-dom_client.js'),{createRoot}=dom.default??dom;
  const {ResearchPanel}=await import('/src/integration/ResearchPanel.tsx');
  const {ResearchController}=await import('/src/integration/research.ts');
  const engine=globalThis.__voicesynth.engine,listeners=new Set();
  let request=null;
  const agent={send:message=>{request=message;},subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},dispose:()=>{}};
  const controller=new ResearchController(engine,agent,()=>true);
  const element=document.createElement('div');element.id='research-panel-fixture';document.body.append(element);
  const root=createRoot(element);
  const wait=async(predicate)=>{const deadline=Date.now()+3000;while(!predicate()){if(Date.now()>deadline)throw new Error('Research UI did not update: '+element.innerText);await new Promise(r=>setTimeout(r,20));}};
  try{
   root.render(React.createElement(ResearchPanel,{controller,session:{...engine.getSession(),selected:{trackId:'synth-1'}},connected:true,enabled:true}));
   await wait(()=>element.querySelector('button'));
   element.querySelector('form').requestSubmit();await wait(()=>request?.type==='sound-request');
   const candidate={id:'fixture-candidate',patch:engine.getSession().tracks[0].patch,previewUrl:'http://127.0.0.1:8000/previews/ui-fixture.wav',score:0.5,provenance:'MOCK ranking UI fixture; not semantic research'};
   listeners.forEach(fn=>fn({type:'research',jobId:request.id,status:'complete',progress:1,candidates:[candidate]}));
   await wait(()=>element.querySelector('audio'));
   if(!element.innerText.includes(candidate.provenance))throw new Error('Missing provenance');
   if(element.querySelector('audio').getAttribute('src')!==candidate.previewUrl)throw new Error('Wrong preview source');
   [...element.querySelectorAll('button')].find(b=>b.textContent==='Use candidate 1').click();
   await wait(()=>element.innerText.includes('Sound change applied'));
   return {candidateRendered:true,provenanceVisible:true,previewSourceCorrect:true,authoritativeAcceptanceVisible:true,mode:'UI fixture with real browser engine; not semantic research'};
  }finally{root.unmount();controller.dispose();element.remove();}
 });
}
