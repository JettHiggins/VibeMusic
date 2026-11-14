import {build} from 'esbuild';
await build({entryPoints:['apps/web/src/engine/worklet.ts'],bundle:true,format:'esm',target:'es2022',outfile:'apps/web/public/engine-runtime.js',external:['/engine/preview-worklet.js']});
