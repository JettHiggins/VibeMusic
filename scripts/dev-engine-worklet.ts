import {context,type BuildContext} from 'esbuild';
import {createHash} from 'node:crypto';
import type {Plugin} from 'vite';
import {projectRoot,workletBuildOptions} from './engine-worklet-build.ts';

/** Dev requests compile current sources; a pulled contract cannot load a stale public worklet. */
export function engineWorkletPlugin(root=projectRoot):Plugin {
 let builder:BuildContext|undefined,lastHash:string|undefined,hadErrors=false;
 return {
  name:'voicesynth-engine-worklet',apply:'serve',
  async configureServer(server){
   builder=await context({...workletBuildOptions(root),write:false,logLevel:'silent',plugins:[{
    name:'reload-audio-worklet',setup(build){build.onEnd(result=>{
     if(result.errors.length){
      hadErrors=true;
      const message=result.errors.map(e=>e.text).join('\n');
      server.config.logger.error(`Audio worklet build failed: ${message}`);
      server.ws.send({type:'error',err:{message:`Audio worklet build failed: ${message}`,stack:'',plugin:'voicesynth-engine-worklet'}});
      return;
     }
     const hash=createHash('sha256').update(result.outputFiles![0].contents).digest('hex');
     if(hadErrors||(lastHash!==undefined&&hash!==lastHash))server.ws.send({type:'full-reload'});
     lastHash=hash;hadErrors=false;
    });},
   }]});
   const active=builder;
   server.middlewares.use((request,response,next)=>{
    if(request.url?.split('?')[0]!=='/engine-runtime.js'){next();return;}
    // Rebuild on request as well as watch: browser HMR can beat the polling watch notification.
    void (async()=>{
     // A watch build may already be reading older sources. Finish it, then build the request snapshot.
     await active.rebuild().catch(()=>undefined);
     return active.rebuild();
    })().then(result=>{
     response.statusCode=200;response.setHeader('Content-Type','application/javascript');
     response.setHeader('Cache-Control','no-store');response.end(result.outputFiles![0].contents);
    },error=>{response.statusCode=500;response.setHeader('Content-Type','text/plain');response.end(`Audio worklet build failed: ${String(error)}`);});
   });
   await active.rebuild();await active.watch();
  },
  async closeBundle(){await builder?.dispose();builder=undefined;},
 };
}
