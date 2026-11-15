async page=>{
 // Actual Python service on8001; only redirect the app socket destination, never fake replies.
 const health=await (await page.request.get('http://127.0.0.1:8001/healthz')).json();
 if(health.research!=='not configured')throw new Error('This negative check requires an unconfigured real service');
 await page.addInitScript(()=>{
  if(globalThis.__searchUnavailableHook)return;globalThis.__searchUnavailableHook=true;
  const Native=globalThis.WebSocket;globalThis.__searchUnavailable={sent:[],received:[]};
  globalThis.WebSocket=class extends Native{
   constructor(url,protocols){super(String(url)==='ws://127.0.0.1:8000/ws'?'ws://127.0.0.1:8001/ws':url,protocols);this.addEventListener('message',e=>{globalThis.__searchUnavailable.received.push(JSON.parse(String(e.data)));});}
   send(data){globalThis.__searchUnavailable.sent.push(JSON.parse(String(data)));return super.send(data);}
  };
 });
 const base=page.url().split('/').slice(0,3).join('/');
 await page.goto(base);await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 await page.getByRole('button',{name:/^Synth 1 /}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.getSession().revision>=1);
 await page.locator('summary').filter({hasText:/^Agent$/}).click();
 await page.getByRole('button',{name:'Connect agent',exact:true}).click();
 await page.getByText('Agent connected',{exact:true}).waitFor();
 const before=await page.evaluate(()=>globalThis.__voicesynth.engine.getSession());
 await page.evaluate(()=>globalThis.__voicesynth.coordinator.submitTranscript('I want an 80s electric piano'));
 await page.waitForFunction(()=>globalThis.__searchUnavailable.received.some(m=>m.type==='error'||m.type==='research'&&m.status==='failed'));
 const result=await page.evaluate(()=>({received:globalThis.__searchUnavailable.received.filter(m=>['research-context','research','error'].includes(m.type)),research:globalThis.__voicesynth.research.getSnapshot(),session:globalThis.__voicesynth.engine.getSession()}));
 if(JSON.stringify(result.session)!==JSON.stringify(before))throw new Error('Unavailable search changed the composition');
 let text;
 if(!health.voiceResearch){
  const error=result.received.find(m=>m.type==='error');
  if(!error||!error.message.includes('spoken sound search is off')||result.received.some(m=>m.type==='research-context'||m.type==='research'))throw new Error('Disabled spoken search was not refused directly: '+JSON.stringify(result.received));
  text='spoken sound search is off';
 }else{
  if(!result.received.some(m=>m.type==='research-context')||result.research.status!=='failed'||!result.research.error)throw new Error('Enabled/unconfigured search failure was not adopted: '+JSON.stringify(result));
  text='sound research is not configured';
 }
 await page.waitForFunction(text=>document.body.innerText.includes(text),text);
 return {voiceResearch:health.voiceResearch,responses:result.received,visibleFailure:true,musicPreserved:true,evidence:'actual app/parser/Python WebSocket with research unconfigured; typed transcript, no STT, model, mock candidates, live provider or physical microphone'};
}
