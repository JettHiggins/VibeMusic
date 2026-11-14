# Synthetic pitch boundary diagnostic — 2026-11-14

WS1 followed up the intermittent strict-grid mismatch in the original real-model melody fixture. This diagnostic runs only the current YIN tracker and note segmenter, with the same harmonic/vibrato/15 ms envelope shape as that fixture. It does not exercise the browser, device, speech gate, audio thread or provider. No input implementation or test assertion was changed.

At 120 BPM a sixteenth is 125 ms and its rounding midpoint is 62.5 ms. Three C4/E4/G4 notes (375/375/500 ms) were shifted through 12 phases within that grid interval. All 36 pitches/counts were correct. Onset error ranged -8.05 to +0.10 ms; end error -1.60 to +6.98 ms. Five onset endpoints and two end endpoints landed in a neighboring cell relative to ideal generated timestamps, all at source phases within 7.5 ms of the rounding midpoint. Every result was identical with block sizes 1024/128 and with block 333 plus absolute start-frame offset 777777 after subtracting that offset.

This reproduces the class of one-cell mismatch without model latency or an audio clock and is consistent with a small boundary-estimation error being magnified by quantization. It does **not** prove this is the sole cause of the browser observation, establish device calibration, explain the ~120 ms human latency report or close timing acceptance. Do not silently change expected notes to observed output or add an undocumented global compensation.

| Phase within sixteenth, ms | C4 onset/end error, ms | E4 onset/end error, ms | G4 onset/end error, ms | Ideal-grid endpoint differences |
| --- | --- | --- | --- | --- |
| 0 | -0.36 / +1.96 | -6.94 / +1.19 | -7.71 / +3.13 | None |
| 35 | -0.53 / +1.79 | -1.30 / +1.02 | -7.88 / +2.96 | None |
| 45 | -4.73 / +3.40 | -5.50 / +2.63 | -6.27 / +4.57 | None |
| 50 | -3.92 / -1.60 | -4.69 / +3.44 | -5.46 / +5.37 | None |
| 55 | -3.12 / -0.79 | -3.89 / +4.24 | -4.66 / +6.18 | None |
| 60 | -2.31 / +0.01 | -3.08 / +5.05 | -3.85 / +6.98 | MIDI 64 [12, 16] vs [12, 15]; MIDI 67 [16, 21] vs [16, 20] |
| 62.5 | -4.81 / +3.32 | -5.58 / +2.55 | -6.35 / +4.48 | MIDI 60 [8, 12] vs [9, 12]; MIDI 64 [12, 16] vs [13, 16]; MIDI 67 [16, 21] vs [17, 21] |
| 65 | -1.51 / +0.82 | -2.28 / +5.85 | -3.05 / +1.98 | MIDI 67 [16, 21] vs [17, 21] |
| 70 | -0.70 / +1.62 | -1.47 / +0.85 | -8.05 / +2.79 | MIDI 67 [16, 21] vs [17, 21] |
| 75 | +0.10 / +2.43 | -6.47 / +1.66 | -7.24 / +3.59 | None |
| 85 | -4.09 / +4.04 | -4.86 / +3.27 | -5.63 / +5.20 | None |
| 100 | -1.68 / +0.65 | -2.45 / +5.68 | -3.22 / +1.81 | None |

WS2 next action: preserve raw captured note start/end and distance from the nearest rounding threshold when investigating a missed grid cell; compare it with independently known source timing and effective calibration. Test real sung attacks/releases and onsets on and around the beat before deciding on extraction bias or UI feedback. The existing tests/input-pitch.test.ts boundary tolerances and chunk/absolute-frame invariance remain in force. The strict browser regression remains unchanged, and its first failure plus later pass remain recorded in BROWSER-SPEECH.md.

## Reproduction

From the repository root, with Node dependencies installed, run this synthetic-only command. It prints numeric measurements and performs block/absolute-frame invariance checks; it never opens a microphone, reads .env, loads a model or calls a provider.

```sh
node --import tsx --input-type=module <<'JS'
import {YinTracker,NoteSegmenter} from './apps/web/src/input/pitch.ts';
const rate=44100, step=rate/8;
const rows=[];
for(const phaseMs of [0,35,45,50,55,60,62.5,65,70,75,85,100]){
 const input=new Float32Array(3*rate);
 const phrase=[[1+phaseMs/1000,.375,60],[1.5+phaseMs/1000,.375,64],[2+phaseMs/1000,.5,67]];
 for(const [at,duration,midi] of phrase){let phase=0;for(let i=0;i<duration*rate;i++){
  const t=i/rate,index=Math.round(at*rate)+i;phase+=2*Math.PI*440*2**((midi-69+.1*Math.sin(2*Math.PI*5*t))/12)/rate;
  const env=Math.min(1,t/.015,(duration-t)/.015);for(let h=1;h<=4;h++)input[index]+=.15*env*Math.sin(h*phase)/(h*h);
 }}
 const analyse=(chunk,offset)=>{
  const yin=new YinTracker({sampleRate:rate}),seg=new NoteSegmenter({sampleRate:rate,hop:yin.hop,noiseFloorDb:-60});
  const notes=[];for(let i=0;i<input.length;i+=chunk)notes.push(...seg.push(yin.process(input.subarray(i,i+chunk),i+offset)));
  notes.push(...seg.flush(input.length+offset));
  return notes.map(n=>({...n,startFrame:n.startFrame-offset,endFrame:n.endFrame-offset}));
 };
 const notes=analyse(1024,0);
 for(const [chunk,offset] of [[128,0],[333,777777]])if(JSON.stringify(analyse(chunk,offset))!==JSON.stringify(notes))throw new Error(`Chunk/absolute-frame dependence at phase ${phaseMs}`);
 rows.push({phaseMs,notes:notes.map((n,i)=>({midi:n.midi,startErrorMs:+((n.startFrame/rate-phrase[i][0])*1000).toFixed(2),endErrorMs:+((n.endFrame/rate-phrase[i][0]-phrase[i][1])*1000).toFixed(2),actual:[Math.round(n.startFrame/step),Math.round(n.endFrame/step)],expected:[Math.round(phrase[i][0]*rate/step),Math.round((phrase[i][0]+phrase[i][1])*rate/step)]}))});
}
console.log(JSON.stringify(rows,null,2));
JS
```
