import {build} from 'esbuild';
import {workletBuildOptions} from './engine-worklet-build.ts';
await build(workletBuildOptions());
