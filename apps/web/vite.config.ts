import {defineConfig} from 'vite';
import {engineWorkletPlugin} from '../../scripts/dev-engine-worklet.ts';
export default defineConfig({plugins:[engineWorkletPlugin()]});
