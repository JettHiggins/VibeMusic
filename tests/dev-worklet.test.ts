import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'vite';
import {engineWorkletPlugin} from '../scripts/dev-engine-worklet.ts';

test('Vite serves current worklet dependencies instead of a stale artifact and recovers from compile errors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'voicesynth-worklet-')),engine=join(root,'apps/web/src/engine');
 await mkdir(engine,{recursive:true});await mkdir(join(root,'apps/web/public'),{recursive:true});
 await writeFile(join(root,'apps/web/public/engine-runtime.js'),'STALE_PUBLIC_ARTIFACT');
 await writeFile(join(engine,'worklet.ts'),"import {version} from './contract.ts'; globalThis.version=version;");
 const dependency=join(engine,'contract.ts');await writeFile(dependency,"export const version='BEFORE_PULL';");
 const server=await createServer({configFile:false,root:join(root,'apps/web'),logLevel:'silent',server:{host:'127.0.0.1',port:0},plugins:[engineWorkletPlugin(root)]});
 try{
  await server.listen();const address=server.httpServer!.address() as {port:number};
  const url=`http://127.0.0.1:${address.port}/engine-runtime.js`;
  const before=await fetch(url);assert.equal(before.status,200);assert.match(await before.text(),/BEFORE_PULL/);assert.equal(before.headers.get('cache-control'),'no-store');
  await writeFile(dependency,"export const version='AFTER_PULL';");
  assert.match(await (await fetch(url)).text(),/AFTER_PULL/,'an immediate request cannot race the file watcher and get the old contract');
  await writeFile(dependency,'export const version = ;');
  const broken=await fetch(url);assert.equal(broken.status,500);assert.match(await broken.text(),/Audio worklet build failed/);
  await writeFile(dependency,"export const version='AFTER_PULL';");
  const recovered=await fetch(url);assert.equal(recovered.status,200);assert.match(await recovered.text(),/AFTER_PULL/);
 }finally{await server.close();await rm(root,{recursive:true,force:true});}
});
