// Microphone capture on the engine's AudioContext. Runs on the audio thread, so it only copies
// samples and stamps them with the shared sample clock; all analysis happens in the worker.
declare const currentFrame: number;
declare class AudioWorkletProcessor { port: MessagePort; constructor(options?: unknown); }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

const BLOCK = 1024;
class CaptureProcessor extends AudioWorkletProcessor {
 private out: MessagePort | null = null;
 private buffer = new Float32Array(BLOCK);
 private filled = 0;
 private startFrame = 0;
 private nextFrame = -1;
 constructor() {
  super();
  this.port.onmessage = ({ data }) => {
   if (data?.type === 'connect') { this.out = data.port as MessagePort; this.filled = 0; this.nextFrame = -1; }
   if (data?.type === 'disconnect') { this.out?.close(); this.out = null; }
  };
 }
 process(inputs: Float32Array[][]) {
  const channels = inputs[0];
  if (!this.out) return true;
  const length = channels?.[0]?.length ?? 128;
  // A gap (e.g. the input was briefly disconnected) flushes and restarts with a fresh start frame.
  if (this.nextFrame !== -1 && currentFrame !== this.nextFrame) this.flush(true);
  for (let i = 0; i < length; i++) {
   if (this.filled === 0) this.startFrame = currentFrame + i;
   let sum = 0;
   if (channels?.length) { for (const channel of channels) sum += channel[i]; sum /= channels.length; }
   this.buffer[this.filled++] = sum;
   if (this.filled === BLOCK) this.flush(false);
  }
  this.nextFrame = currentFrame + length;
  return true;
 }
 private flush(discontinuity: boolean) {
  if (this.filled && this.out) {
   const samples = this.buffer.slice(0, this.filled);
   this.out.postMessage({ type: 'audio', startFrame: this.startFrame, samples, discontinuity: false }, [samples.buffer]);
  }
  this.filled = 0;
  if (discontinuity) this.out?.postMessage({ type: 'gap' });
 }
}
registerProcessor('voicesynth-capture', CaptureProcessor);
