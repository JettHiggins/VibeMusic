import type { SpeechAudio } from '@voicesynth/contracts';

/** Worker-side PCM chunking on the context clock. No resampling: approved 44.1 kHz PCM
 * preserves sample/frame identity; the recognizer adapter owns any model-rate conversion. */
export class SpeechPcmEncoder {
 private nextRaw: number | null = null;
 private start = 0;
 private used = 0;
 private seq = 0;
 private failed = false;
 private buffer: Float32Array;
 private latency: number;
 constructor(private config: {streamId: string; clockId: string; sampleRate: number; latencyFrames: number}, private emit: (message: SpeechAudio) => void) {
  if (!Number.isInteger(config.sampleRate) || config.sampleRate < 8000 || config.sampleRate > 48000 || !Number.isFinite(config.latencyFrames)) throw new Error('Invalid speech capture clock/calibration');
  // Match PerformanceRecorder's Math.round(rawFrame - latencyFrames), including fractional latency.
  this.latency = -Math.round(-config.latencyFrames);
  this.buffer = new Float32Array(Math.round(config.sampleRate / 10));
 }
 push(rawStart: number, samples: Float32Array) {
  if (this.failed) return;
  if (!Number.isSafeInteger(rawStart) || rawStart < 0 || (this.nextRaw !== null && rawStart !== this.nextRaw)) { this.fail(); throw new Error('Speech capture gap; start a new stream and capture epoch'); }
  this.nextRaw = rawStart + samples.length;
  const corrected = rawStart - this.latency;
  // Remove PCM corresponding to negative corrected time, rather than merely clamping the header.
  let offset = Math.max(0, -corrected);
  while (offset < samples.length) {
   if (!this.used) this.start = corrected + offset;
   const count = Math.min(samples.length - offset, this.buffer.length - this.used);
   this.buffer.set(samples.subarray(offset, offset + count), this.used);
   this.used += count; offset += count;
   if (this.used === this.buffer.length) this.flush();
  }
 }
 flush() {
  if (this.failed || !this.used) return;
  const bytes = new Uint8Array(this.used * 2), view = new DataView(bytes.buffer);
  for (let i = 0; i < this.used; i++) {
   const sample = Number.isFinite(this.buffer[i]) ? Math.max(-1, Math.min(1, this.buffer[i])) : 0;
   view.setInt16(i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  const message: SpeechAudio = {type:'speech-audio',streamId:this.config.streamId,clockId:this.config.clockId,seq:this.seq++,startFrame:this.start,endFrame:this.start+this.used,sampleRate:this.config.sampleRate,encoding:'pcm-s16le',data:btoa(binary)};
  this.used = 0;
  this.emit(message);
 }
 fail() { this.failed = true; this.used = 0; }
}
