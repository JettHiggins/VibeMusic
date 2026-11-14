import { effectiveLatencyFrames, type InputCalibration } from './calibration.ts';
import type { MicCheckState } from './mic-check.ts';
import type { RecorderStatus } from './recorder.ts';
import type { ProcessingProfile } from './processing-profile.ts';

/** What the browser reports for the capture track. Values are as granted, not as requested. */
export interface CaptureSettings {
 echoCancellation?: boolean;
 noiseSuppression?: boolean;
 autoGainControl?: boolean;
 sampleRate?: number;
 latency?: number;
 channelCount?: number;
}

/**
 * Opt-in microphone test report for posting to a GitHub issue. Contains measurements only: no
 * audio, no device labels or IDs, no session/music content.
 */
export interface MicTestReport {
 format: 'voicesynth-mic-test';
 version: 2;
 createdAt: string;
 browser: string;
 context: { sampleRate: number; baseLatencyMs: number | null; outputLatencyMs: number | null };
 capture: CaptureSettings & { processingProfile: ProcessingProfile; processingMatchesProfile: boolean | null };
 calibration: { noiseFloorDb: number; noiseMeasured: boolean; latencyMs: number; latencySource: string; latencySpreadMs: number | null; offsetAdjustMs: number; effectiveLatencyMs: number } | null;
 micCheck: Pick<MicCheckState, 'peakDb' | 'verdict' | 'noisyRoom' | 'onsetsDetected' | 'notesDetected'> & { lastOnsetLevelDb: number | null; lastNoteMidi: number | null };
 takes: { committed: number; dropped: number; lastError: string | null };
 analysisP95Ms: number | null;
}

const ms = (frames: number, rate: number) => Math.round(frames / rate * 10000) / 10;

export function buildMicTestReport(input: {
 now?: Date; browser: string; context: { sampleRate: number; baseLatency?: number; outputLatency?: number }; processingProfile?: ProcessingProfile;
 capture: CaptureSettings; calibration: InputCalibration | null; micCheck: MicCheckState; recorder: RecorderStatus; analysisP95Ms: number | null;
}): MicTestReport {
 const { calibration: c, context, capture, micCheck, recorder } = input;
 const processingProfile = input.processingProfile ?? 'noisy-room';
 const expected = { echoCancellation: false, noiseSuppression: processingProfile === 'noisy-room', autoGainControl: false };
 const reported = [capture.echoCancellation, capture.noiseSuppression, capture.autoGainControl];
 const matches = reported.some(value => value === undefined) ? null : capture.echoCancellation === expected.echoCancellation && capture.noiseSuppression === expected.noiseSuppression && capture.autoGainControl === expected.autoGainControl;
 return {
  format: 'voicesynth-mic-test', version: 2, createdAt: (input.now ?? new Date()).toISOString(), browser: input.browser,
  context: { sampleRate: context.sampleRate, baseLatencyMs: context.baseLatency === undefined ? null : Math.round(context.baseLatency * 10000) / 10, outputLatencyMs: context.outputLatency === undefined ? null : Math.round(context.outputLatency * 10000) / 10 },
  capture: { ...pick(capture), processingProfile, processingMatchesProfile: matches },
  calibration: c && { noiseFloorDb: Math.round(c.noiseFloorDb * 10) / 10, noiseMeasured: c.noiseSource === 'measured', latencyMs: ms(c.latencyFrames, c.sampleRate), latencySource: c.latencySource, latencySpreadMs: c.latencySpreadFrames === null ? null : ms(c.latencySpreadFrames, c.sampleRate), offsetAdjustMs: c.offsetAdjustMs ?? 0, effectiveLatencyMs: ms(effectiveLatencyFrames(c), c.sampleRate) },
  micCheck: { peakDb: Number.isFinite(micCheck.peakDb) ? Math.round(micCheck.peakDb * 10) / 10 : -120, verdict: micCheck.verdict, noisyRoom: micCheck.noisyRoom, onsetsDetected: micCheck.onsetsDetected, notesDetected: micCheck.notesDetected, lastOnsetLevelDb: micCheck.lastOnset ? Math.round(micCheck.lastOnset.levelDb * 10) / 10 : null, lastNoteMidi: micCheck.lastNote?.midi ?? null },
  takes: { committed: recorder.committed, dropped: recorder.dropped, lastError: recorder.lastError },
  analysisP95Ms: input.analysisP95Ms === null ? null : Math.round(input.analysisP95Ms * 10) / 10,
 };
}

function pick(s: CaptureSettings): CaptureSettings {
 const { echoCancellation, noiseSuppression, autoGainControl, sampleRate, latency, channelCount } = s;
 return { echoCancellation, noiseSuppression, autoGainControl, sampleRate, latency, channelCount };
}
