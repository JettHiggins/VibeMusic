import type {BuildOptions} from 'esbuild';
import {fileURLToPath} from 'node:url';
export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export function workletBuildOptions(root=projectRoot):BuildOptions {
 return {absWorkingDir:root,entryPoints:['apps/web/src/engine/worklet.ts'],bundle:true,format:'esm',target:'es2022',outfile:'apps/web/public/engine-runtime.js',external:['/engine/preview-worklet.js']};
}
