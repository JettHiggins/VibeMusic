import type {ServerMessage} from '@voicesynth/contracts';
import type {PerformanceRecorder} from './recorder.ts';
/** Both message timestamps are already on the latency-corrected performance timeline. */
export function handleSpeechMessage(recorder:Pick<PerformanceRecorder,'verifyThrough'|'addCommandSpan'>,message:ServerMessage){
 if(message.type==='speech-verified')recorder.verifyThrough(message.clockId,message.throughFrame);
 if(message.type==='command-span')recorder.addCommandSpan({clockId:message.clockId,startFrame:message.startFrame,endFrame:message.endFrame});
}
