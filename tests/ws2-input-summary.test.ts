import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { VoiceInputState } from '../apps/web/src/input/voice-input.ts';
import type { MicCheckState } from '../apps/web/src/input/mic-check.ts';
import { summarizeInput, takeLine } from '../apps/web/src/ui/input-summary.ts';

const base = (over: Partial<VoiceInputState> = {}): VoiceInputState => ({
 speech: { enabled: false, status: 'off', message: null }, microphone: 'on', processingProfile: 'noisy-room', levelDb: -30,
 calibration: { deviceId: 'mic', sampleRate: 48000, latencyFrames: 4800, latencySource: 'tap-along', noiseFloorDb: -60, noiseSource: 'measured', offsetAdjustMs: 0 } as VoiceInputState['calibration'],
 calibrating: null, recorder: { mode: 'manual', capturing: false, provisional: [], timing: [], committed: 0, dropped: 0, lastError: null, inFlight: null },
 analysisP95Ms: null, message: null, micCheck: null, capture: null, readiness: { ready: true, missing: [], advice: 'Ready.' },
 calibrationRun: null, silenceRun: null, calibrationResult: null, inputActionRunning: false, ...over,
});
const check = (over: Partial<MicCheckState> = {}): MicCheckState => ({
 peakDb: -20, verdict: 'ok', noisyRoom: false, onsetsDetected: 0, lastOnset: null, notesDetected: 0, lastNote: null, advice: 'Level is good.',
 pitch: null, pitchAdvice: 'Sing or hum a steady note to check pitch detection.', foregroundDb: null, foregroundMarginDb: null, foregroundAdvice: '', ...over,
});

test('heard pitch stays raw while output shows the key-mapped note', () => {
 const state = base({ micCheck: check({ pitch: { state: 'pitch', midi: 68, clarity: 0.93, levelDb: -25, gateDb: -48, holding: true } }) });
 const off = summarizeInput(state, true, null);
 assert.equal(off.pitch?.heard, 'G♯4');
 assert.equal(off.pitch?.output, null, 'no separate output when the key is Off');
 assert.equal(off.key, 'Off');
 const cMajor = summarizeInput(state, true, { root: 0, scale: 'major' });
 assert.equal(cMajor.pitch?.heard, 'G♯4', 'raw pitch is never replaced by the snapped one');
 assert.equal(cMajor.pitch?.output, 'G4');
 assert.equal(cMajor.pitch?.gate, 'Holding note');
 assert.equal(cMajor.key, 'C major');
 const inKey = summarizeInput(base({ micCheck: check({ pitch: { state: 'pitch', midi: 67, clarity: 0.9, levelDb: -25, gateDb: -48, holding: false } }) }), true, { root: 0, scale: 'major' });
 assert.equal(inKey.pitch?.output, null, 'an in-key note has no separate output');
});

test('quiet and unclear input explain the existing gate reading instead of inventing a note', () => {
 const quiet = summarizeInput(base({ micCheck: check({ pitch: { state: 'quiet', midi: 60, clarity: 0.9, levelDb: -52, gateDb: -48, holding: false }, pitchAdvice: 'Voice heard at -52 dBFS but notes need -48 dBFS: sing louder or closer.' }) }), true, null);
 assert.equal(quiet.pitch?.heard, '—');
 assert.equal(quiet.pitch?.gate, 'Below note level');
 assert.equal(quiet.pitch?.detail, '-52 of -48 dBFS needed');
 assert.equal(quiet.level.gateDb, -48);
 assert.ok(quiet.notices.some(n => n.id === 'pitch' && n.text.includes('sing louder')));
 const unclear = summarizeInput(base({ micCheck: check({ pitch: { state: 'unclear', midi: null, clarity: 0.41, levelDb: -30, gateDb: -48, holding: false } }) }), true, null);
 assert.equal(unclear.pitch?.gate, 'Pitch unclear');
 assert.equal(unclear.pitch?.detail, 'clarity 0.41');
 // Drums show hit feedback, not pitch.
 const drums = summarizeInput(base({ micCheck: check({ onsetsDetected: 3, lastOnset: { levelDb: -18, confidence: 0.8, accepted: false } }) }), false, null);
 assert.equal(drums.pitch, null);
 assert.equal(drums.hit, 'Last hit -18 dBFS · weak · 3 detected');
});

test('notices are prioritized, deduplicated and offer setup when calibration is missing', () => {
 const long = 'Language provider error: 429 '.padEnd(400, 'x');
 const state = base({
  message: long,
  speech: { enabled: true, status: 'unavailable', message: long },
  readiness: { ready: false, missing: ['calibrate-timing'], advice: 'Calibrate timing before recording.' },
  micCheck: check({ verdict: 'too-quiet', advice: 'Too quiet: perform louder.' }),
 });
 const s = summarizeInput(state, true, null);
 assert.deepEqual(s.notices.map(n => n.id), ['input', 'readiness', 'level'], 'identical speech text is not repeated');
 assert.equal(s.notices[0].text, long, 'long errors are kept whole for the expandable notice');
 assert.equal(s.notices.find(n => n.id === 'readiness')?.action, 'setup');
 assert.deepEqual(s.status, { label: 'Too quiet', tone: 'warn' });
 const running = summarizeInput(base({ calibrationResult: { ok: false, text: 'Not enough quiet audio.' }, silenceRun: { phase: 'measuring' } }), true, null);
 assert.equal(running.notices.length, 0, 'an old failure is not shown over a new running measurement');
});

test('microphone states and take counters stay concise', () => {
 assert.deepEqual(summarizeInput(base({ microphone: 'off', calibration: null }), true, null).status, { label: 'Microphone off', tone: 'muted' });
 assert.equal(summarizeInput(base({ microphone: 'off' }), true, null).pitch, null);
 assert.equal(summarizeInput(base({ micCheck: check({ verdict: 'clipping', advice: 'Input is clipping.' }) }), true, null).notices[0].tone, 'alert');
 assert.equal(takeLine(base(), true), null);
 const recorder = { ...base().recorder, capturing: true, committed: 4, dropped: 1, provisional: [
  { event: {} as never, step: 0, duration: 1, status: 'provisional' as const },
  { event: {} as never, step: 2, duration: 1, status: 'submitted' as const }] };
 assert.equal(takeLine(base({ recorder }), true), '1 note heard · 1 queued · 4 committed · 1 ignored');
 assert.equal(takeLine(base({ recorder: { ...recorder, dropped: 0 } }), false), '1 hit heard · 1 queued · 4 committed');
});
