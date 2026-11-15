async page => {
 await page.getByRole('banner',{name:'Status display'}).getByRole('button',{name:'Play',exact:true}).click();
 await page.getByRole('tab',{name:'Edit',exact:true}).click();
 const lane=page.getByLabel('Kick steps',{exact:true});
 await lane.getByRole('button',{name:'Step 1',exact:true}).click();
 await lane.getByRole('button',{name:'Step 2',exact:true}).click();
 await page.getByRole('tab',{name:'Session',exact:true}).click();
 await page.waitForFunction(()=>{
  const hits=globalThis.__voicesynth.engine.getSession().tracks[3].hits;
  return !hits.some(h=>h.lane==='kick'&&h.step===0)&&hits.some(h=>h.lane==='kick'&&h.step===1);
 },null,{timeout:18000});
 return {queuedEditsSurvivedTabSwitch:true};
}
