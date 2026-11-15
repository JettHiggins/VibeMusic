async page=>{
 // Mic-enabled workspace layout at laptop sizes: no page-wide horizontal scroll, essentials reachable,
 // long errors wrap inside the inspector, collapsed sections keyboard-operable. Synthetic input only.
 const base=page.url().startsWith('http://127.0.0.1:')?page.url().split('/').slice(0,3).join('/'):'http://127.0.0.1:5173';
 const long='Language provider error: 429 Too Many Requests; free-model quota or rate limit reached for openrouter/some-very-long-model-identifier:free; retry after https://openrouter.ai/settings/credits?ref=abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz';
 const results=[];
 for(const [width,height] of [[1280,720],[1366,768],[1440,900]]){
  await page.setViewportSize({width,height});
  await page.goto(base);
  await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.getByRole('button',{name:'Not now',exact:true}).click();
  await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
  await page.getByRole('button',{name:/^Synth 1 /}).click();
  await page.evaluate(async long=>{
   const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext();
   await voice.enableTestSignal(context.createBuffer(1,context.sampleRate*20,context.sampleRate),context.currentTime+.05);
   voice.update({message:long,speech:{enabled:true,status:'unavailable',message:'Unsupported message type browser-status. '+long},recorder:{...voice.getState().recorder,lastError:long}});
  },long);
  for(const details of await page.locator('details').all())await details.evaluate(d=>{d.open=true;});
  const layout=await page.evaluate(()=>{
   const W=document.documentElement.clientWidth;
   const overflow=[...document.querySelectorAll('.vs *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>W+1;}).map(e=>e.tagName+':'+(e.getAttribute('aria-label')||e.textContent.slice(0,40)));
   return {scrollWidth:document.documentElement.scrollWidth,clientWidth:W,overflow};
  });
  if(layout.scrollWidth>layout.clientWidth||layout.overflow.length)throw new Error(`Horizontal overflow at ${width}x${height}: `+JSON.stringify(layout));
  for(const name of ['Play','Undo','Restart mic','Measure silence'])if(!await page.getByRole('button',{name,exact:true}).isVisible())throw new Error(`${name} not visible at ${width}x${height}`);
  await page.getByRole('button',{name:'Full message',exact:true}).first().press('Enter');
  if(await page.getByRole('button',{name:'Less',exact:true}).first().getAttribute('aria-expanded')!=='true')throw new Error('Long notice did not expand by keyboard');
  const setup=page.locator('summary',{hasText:'Microphone setup'});
  await setup.evaluate(s=>{s.parentElement.open=false;});
  await setup.focus();await page.keyboard.press('Enter');
  if(!await setup.evaluate(s=>s.parentElement.open))throw new Error('Setup did not open by keyboard');
  results.push({width,height,...layout});
 }
 return {results,evidence:'actual browser layout with test-signal input and injected long errors; not a physical microphone'};
}
