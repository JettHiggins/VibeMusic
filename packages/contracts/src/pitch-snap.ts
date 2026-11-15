import type {PitchSnap} from './index.ts';
const SCALES={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10]} as const;
/** Nearest in-range scale pitch; exact ties choose the lower note. Missing/null means Off. */
export function snapMidiToScale(midi:number,settings?:PitchSnap|null):number{
 if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI pitch must be an integer from 0 to 127');
 if(!settings)return midi;
 if(!Number.isInteger(settings.root)||settings.root<0||settings.root>11||!Object.hasOwn(SCALES,settings.scale))throw new RangeError('Invalid pitch-snap settings');
 const intervals:readonly number[]=SCALES[settings.scale];
 const allowed=(n:number)=>n>=0&&n<=127&&intervals.includes(((n-settings.root)%12+12)%12);
 for(let distance=0;distance<=12;distance++){
  if(allowed(midi-distance))return midi-distance;
  if(allowed(midi+distance))return midi+distance;
 }
 throw new RangeError('No scale pitch in MIDI range');
}

/** Sixteenth-note cells per rhythm-grid unit. Missing rhythmSnap means sixteenth (legacy). */
export const RHYTHM_CELLS={sixteenth:1,eighth:2,quarter:4} as const;

/**
 * Extra pitches (third, fifth) for chord mode `triad` on an already snapped root. With a key, the
 * third and fifth are the 2nd and 4th scale degrees above the root (diatonic triad); without one,
 * a major triad. Pitches outside MIDI 0..127 are omitted rather than wrapped.
 */
export function triadFor(root:number,settings?:PitchSnap|null):number[]{
 if(!Number.isInteger(root)||root<0||root>127)throw new RangeError('MIDI pitch must be an integer from 0 to 127');
 let intervals=[4,7];
 if(settings){
  const scale:readonly number[]=SCALES[settings.scale];
  const degree=scale.indexOf(((root-settings.root)%12+12)%12);
  if(degree>=0)intervals=[2,4].map(step=>{const target=degree+step;return scale[target%7]+12*Math.floor(target/7)-scale[degree];});
 }
 return intervals.map(i=>root+i).filter(n=>n<=127);
}
