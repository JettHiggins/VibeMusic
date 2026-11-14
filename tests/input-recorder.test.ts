import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, SessionCommand as CommandSchema, type ClientMessage, type SessionCommand, type SessionState, type Transport } from '../packages/contracts/src/index.ts';
import { commitPerformance, type RecordingWindow } from '../apps/web/src/engine/performance.ts';
import { PerformanceRecorder } from '../apps/web/src/input/recorder.ts';
import type { Onset } from '../apps/web/src/input/onset.ts';

const STEP = 5512.5, START = 441000, CLOCK = 'clock-a';
/** Engine double: real quantization/validation, revision checks, next-loop queueing until boundary(). */
class FakeEngine {
 session: SessionState = createSession();
 frame = START;
 window: RecordingWindow = { startFrame: START, endFrame: null, loopStartFrame: START, tempo: 120, target: { trackId: 'drums', lane: 'kick' } };
 queued: SessionCommand[] = [];
 sent: SessionCommand[] = [];
 listeners: ((m: ClientMessage) => void)[] = [];
 emit(m: ClientMessage) { this.listeners.forEach(l => l(m)); }
 dispatch = (input: SessionCommand): ClientMessage => {
  const c = CommandSchema.parse(input); this.sent.push(c);
  if (c.expectedRevision !== this.session.revision) return this.ack(c, 'rejected', 'Stale revision');
  if(c.operation.type==='commit-performance'&&c.operation.replacesCommandId){
   const replaces=c.operation.replacesCommandId;
   const index=this.queued.findIndex(queued=>queued.id===replaces);
   if(index<0)return this.ack(c,'rejected','Performance batch no longer queued');
   const old=this.queued[index];this.queued[index]=c;this.ack(old,'rejected','Performance batch superseded');
  }else this.queued.push(c);
  return this.ack(c, 'queued');
 };
 ack(c: SessionCommand, status: 'queued' | 'applied' | 'rejected', reason?: string): ClientMessage {
  const m: ClientMessage = { type: 'ack', commandId: c.id, status, revision: this.session.revision, ...(reason ? { reason } : {}) };
  this.emit(m); return m;
 }
 boundary() {
  const queued = this.queued; this.queued = [];
  for (const c of queued) {
   try {
    if (c.expectedRevision !== this.session.revision) throw new Error('Stale revision');
    if (c.operation.type !== 'commit-performance') { this.session = { ...this.session, revision: this.session.revision + 1 }; }
    else { const next = commitPerformance(this.session, c.operation, this.window, CLOCK, this.frame); next.revision++; this.session = next; }
    this.ack(c, 'applied'); this.emit({ type: 'session', session: structuredClone(this.session) });
   } catch (e) { this.ack(c, 'rejected', String(e)); }
  }
 }
 transport(overrides: Partial<Transport> = {}): ClientMessage {
  return { type: 'transport', transport: { clockId: CLOCK, sampleRate: 44100, currentFrame: this.frame, loopStartFrame: START, playing: true, recording: this.window.endFrame === null, recordingState: this.window.endFrame === null ? 'recording' : 'idle', recordingStartFrame: START, recordingTarget: this.window.target, pendingCommandIds: this.queued.map(c => c.id), ...overrides } };
 }
}
function setup(mode: 'manual' | 'speech' = 'manual') {
 const engine = new FakeEngine();
 let n = 0;
 const recorder = new PerformanceRecorder({ dispatch: engine.dispatch, newId: () => `id-${++n}` }, mode);
 engine.listeners.push(m => recorder.handle(m));
 recorder.handle({ type: 'session', session: engine.session });
 const advance = (frames: number) => { engine.frame += frames; recorder.handle(engine.transport()); };
 const hit = (step: number, latency = 0, confidence = 0.9): Onset => ({ frame: Math.round(START + step * STEP) + latency, velocity: 0.8, confidence, levelDb: -12 });
 return { engine, recorder, advance, hit };
}
const kicks = (s: SessionState) => s.tracks[3].hits.filter(h => h.lane === 'kick').map(h => h.step).sort((a, b) => a - b);

test('manual takes commit latency-compensated hits once, quantized to sixteenths', () => {
 const { engine, recorder, advance, hit } = setup();
 advance(64 * STEP);
 const latency = 4000;
 recorder.addOnsets([hit(0.2, latency), hit(4.4, latency), hit(9.6, latency)], latency, CLOCK, engine.frame + latency);
 assert.equal(engine.sent.length, 1);
 const op = engine.sent[0].operation;
 assert.equal(op.type, 'commit-performance');
 if (op.type === 'commit-performance') assert.deepEqual(op.events.map(e => e.captureFrame), [0.2, 4.4, 9.6].map(s => Math.round(START + s * STEP)));
 engine.boundary();
 assert.deepEqual(kicks(engine.session), [0, 4, 10]);
 assert.equal(recorder.status().committed, 3);
 assert.equal(recorder.status().provisional.length, 0);
});

test('later verified hits replace the queued batch before the same loop boundary', () => {
 const { engine, recorder, advance, hit } = setup();
 advance(20 * STEP);
 recorder.addOnsets([hit(1)], 0, CLOCK, engine.frame);
 recorder.addOnsets([hit(3)], 0, CLOCK, engine.frame);
 assert.equal(engine.sent.length, 2);
 assert.equal(engine.queued.length,1);
 assert.deepEqual(recorder.status().provisional.map(p => p.status), ['submitted', 'submitted']);
 engine.boundary();
 assert.equal(recorder.status().committed,2);
 assert.deepEqual(kicks(engine.session), [1, 3]);
});

test('hits are not committed beyond analysed audio or the engine clock', () => {
 const { engine, recorder, advance, hit } = setup();
 advance(4 * STEP);
 recorder.addOnsets([hit(2), hit(8)], 0, CLOCK, START + 3 * STEP);
 const op = engine.sent[0].operation;
 assert.ok(op.type === 'commit-performance' && op.events.length === 1 && op.verifiedThroughFrame <= START + 3 * STEP);
 engine.boundary();
 advance(10 * STEP);
 assert.equal(engine.sent.length, 1, 'clock progress alone does not verify unanalysed audio');
 recorder.addOnsets([], 0, CLOCK, engine.frame);
 assert.equal(engine.sent.length, 2, 'the held hit is sent once analysis passes it');
});

test('speech mode waits for verification, excludes command spans, and stops on disconnect', () => {
 const { engine, recorder, advance, hit } = setup('speech');
 recorder.setSpeechAvailable(true);
 advance(40 * STEP);
 recorder.addOnsets([hit(2), hit(6), hit(20)], 0, CLOCK, engine.frame);
 assert.equal(engine.sent.length, 0, 'nothing commits before speech classification');
 const span = { clockId: CLOCK, startFrame: Math.round(START + 5.5 * STEP), endFrame: Math.round(START + 8 * STEP) };
 recorder.addCommandSpan(span);
 assert.equal(recorder.status().provisional.length, 2, 'the hit inside “Groove …” is removed');
 recorder.verifyThrough(CLOCK, START + 10 * STEP);
 const op = engine.sent[0].operation;
 assert.ok(op.type === 'commit-performance');
 if (op.type === 'commit-performance') { assert.equal(op.events.length, 1); assert.deepEqual(op.excludedSpans, []); }
 engine.boundary();
 recorder.setSpeechAvailable(false);
 assert.equal(recorder.capturing, false);
 assert.equal(recorder.status().provisional.length, 0);
 assert.match(recorder.status().lastError ?? '', /disconnected/);
 recorder.addOnsets([hit(30)], 0, CLOCK, engine.frame);
 recorder.verifyThrough(CLOCK, engine.frame);
 assert.equal(engine.sent.length, 1, 'no commits while speech is unavailable');
 assert.deepEqual(kicks(engine.session), [2]);
});

test('command spans overlapping a batch are passed to the engine', () => {
 const { engine, recorder, advance, hit } = setup('speech');
 recorder.setSpeechAvailable(true); advance(30 * STEP);
 recorder.addOnsets([hit(2), hit(12)], 0, CLOCK, engine.frame);
 const span = { clockId: CLOCK, startFrame: Math.round(START + 6 * STEP), endFrame: Math.round(START + 7 * STEP) };
 recorder.addCommandSpan(span);
 recorder.verifyThrough(CLOCK, engine.frame);
 const op = engine.sent[0].operation;
 assert.ok(op.type === 'commit-performance');
 if (op.type === 'commit-performance') assert.deepEqual(op.excludedSpans, [{ startFrame: span.startFrame, endFrame: span.endFrame }]);
});

test('stale batches are resubmitted with a new ID after the newer snapshot; other rejections are reported', () => {
 const { engine, recorder, advance, hit } = setup();
 advance(20 * STEP);
 // Another mutation (e.g. mute) lands first, so the batch built on revision 0 becomes stale.
 engine.dispatch({ id: 'other', expectedRevision: 0, boundary: 'next-loop', operation: { type: 'mute', trackId: 'synth-1', muted: true } });
 recorder.addOnsets([hit(5)], 0, CLOCK, engine.frame);
 engine.boundary();
 assert.equal(engine.sent.length, 3, 'resubmitted after the stale rejection');
 assert.notEqual(engine.sent[2].id, engine.sent[1].id);
 assert.equal(engine.sent[2].expectedRevision, 1);
 engine.boundary();
 assert.deepEqual(kicks(engine.session), [5]);
 // A semantic rejection is not retried forever.
 engine.window = { ...engine.window, target: { trackId: 'drums', lane: 'snare' } };
 recorder.addOnsets([hit(9)], 0, CLOCK, engine.frame);
 engine.boundary();
 assert.match(recorder.status().lastError ?? '', /target/);
 assert.equal(recorder.status().provisional.length, 0);
});

test('low-confidence onsets are counted as ignored rather than committed', () => {
 const { engine, recorder, advance, hit } = setup();
 advance(20 * STEP);
 recorder.addOnsets([hit(2, 0, 0.4), hit(4)], 0, CLOCK, engine.frame);
 const op = engine.sent[0].operation;
 assert.ok(op.type === 'commit-performance' && op.events.length === 1);
 engine.boundary();
 assert.equal(recorder.status().committed, 1);
 assert.equal(recorder.status().dropped, 1);
});

test('hits outside the take, from another clock, or after stop are dropped locally', () => {
 const { engine, recorder, advance, hit } = setup();
 advance(30 * STEP);
 recorder.addOnsets([{ ...hit(0), frame: START - 500 }], 0, CLOCK, engine.frame);
 recorder.addOnsets([hit(3)], 0, 'other-clock', engine.frame);
 assert.equal(engine.sent.length, 0);
 assert.equal(recorder.status().dropped, 2);
 const cutoff = engine.frame;
 engine.window.endFrame = cutoff + 1000;
 recorder.handle(engine.transport({ currentFrame: cutoff + 2048, recording: false, recordingState: 'idle' }));
 engine.frame = cutoff + 2048;
 recorder.addOnsets([{ ...hit(0), frame: cutoff + 1500 }, { ...hit(0), frame: cutoff - 100 }], 0, CLOCK, cutoff + 2048);
 assert.equal(recorder.capturing, false);
 assert.equal(engine.sent.length, 0, 'onsets arriving after the take closed are not accepted');
});

test('a final verified batch still commits after stop-recording', () => {
 const { engine, recorder, advance, hit } = setup();
 advance(20 * STEP);
 recorder.addOnsets([hit(2)], 0, CLOCK, START + 1 * STEP); // analysis lags behind the hit
 assert.equal(engine.sent.length, 0);
 engine.window.endFrame = engine.frame;
 recorder.handle(engine.transport({ recording: false, recordingState: 'idle' }));
 recorder.addOnsets([], 0, CLOCK, engine.frame);
 assert.equal(engine.sent.length, 1);
 engine.boundary();
 assert.deepEqual(kicks(engine.session), [2]);
});
