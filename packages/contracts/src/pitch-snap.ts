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
