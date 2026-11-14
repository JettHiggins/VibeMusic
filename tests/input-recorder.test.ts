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
  this.queued.push(c); return this.ack(c, 'queued');
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
function setup(mode: 'manual' | 'speech' = 'manual', batchLeadSeconds = Infinity) {
 const engine = new FakeEngine();
 let n = 0;
 // Most tests submit immediately; boundary-timed batching has its own test.
 const recorder = new PerformanceRecorder({ dispatch: engine.dispatch, newId: () => `id-${++n}` }, mode, { batchLeadSeconds });
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

test('only one batch is in flight; later hits wait for the authoritative acknowledgment', () => {
 const { engine, recorder, advance, hit } = setup();
 advance(20 * STEP);
 recorder.addOnsets([hit(1)], 0, CLOCK, engine.frame);
 recorder.addOnsets([hit(3)], 0, CLOCK, engine.frame);
 assert.equal(engine.sent.length, 1);
 assert.deepEqual(recorder.status().provisional.map(p => p.status), ['submitted', 'provisional']);
 engine.boundary();
 assert.equal(engine.sent.length, 2);
 engine.boundary();
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
 assert.equal(engine.sent.length, 1, 'late analysis of audio before the cut-off still counts');
 const op = engine.sent[0].operation;
 assert.ok(op.type === 'commit-performance');
 if (op.type === 'commit-performance') assert.deepEqual(op.events.map(e => e.captureFrame), [cutoff - 100], 'audio after the cut-off is dropped');
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

function melodic() {
 const s = setup();
 s.engine.window = { ...s.engine.window, target: { trackId: 'synth-1' } };
 return s;
}
const note = (start: number, end: number, midi = 64, confidence = 0.9) => ({ startFrame: Math.round(START + start * STEP), endFrame: Math.round(START + end * STEP), midi, velocity: 0.7, confidence });

test('sung notes commit to melodic takes with quantized starts and durations', () => {
 const { engine, recorder, advance } = melodic();
 advance(30 * STEP);
 recorder.addNotes([note(0.2, 3.9, 60), note(4.1, 6.2, 62)], 0, CLOCK, engine.frame);
 assert.deepEqual(recorder.status().provisional.map(p => [p.step, p.duration]), [[0, 4], [4, 2]]);
 engine.boundary();
 assert.deepEqual(engine.session.tracks[0].notes.map(n => [n.step, n.duration, n.midi]), [[0, 4, 60], [4, 2, 62]]);
});

test('notes wait until their end is analysed, onsets are ignored on melodic takes and vice versa', () => {
 const { engine, recorder, advance, hit } = melodic();
 advance(30 * STEP);
 recorder.addOnsets([hit(1)], 0, CLOCK, START + 5 * STEP);
 recorder.addNotes([note(2, 20)], 0, CLOCK, START + 10 * STEP);
 assert.equal(engine.sent.length, 0, 'note end not yet analysed');
 assert.equal(recorder.status().dropped, 0, 'drum onsets during a sung take are irrelevant, not ignored');
 recorder.addNotes([], 0, CLOCK, START + 21 * STEP);
 assert.equal(engine.sent.length, 1);
 const drums = setup(); drums.advance(10 * STEP);
 drums.recorder.addNotes([note(1, 3)], 0, CLOCK, drums.engine.frame);
 assert.equal(drums.engine.sent.length, 0);
});

test('a note still sounding at stop is clamped to the cut-off; notes overlapping speech are excluded', () => {
 const { engine, recorder, advance } = melodic();
 recorder.setMode('speech'); recorder.setSpeechAvailable(true);
 advance(20 * STEP);
 const cutoff = engine.frame;
 engine.window.endFrame = cutoff + 500;
 recorder.handle(engine.transport({ recording: false, recordingState: 'idle' }));
 recorder.addCommandSpan({ clockId: CLOCK, startFrame: Math.round(START + 10 * STEP), endFrame: Math.round(START + 12 * STEP) });
 recorder.addNotes([note(2, 6, 60), note(9, 11, 67), note(16, 30, 64)], 0, CLOCK, START + 31 * STEP);
 recorder.verifyThrough(CLOCK, cutoff);
 const op = engine.sent[0].operation;
 assert.ok(op.type === 'commit-performance');
 if (op.type === 'commit-performance') {
  assert.deepEqual(op.events.map(e => e.kind === 'note' ? [e.midi, e.endFrame <= cutoff] : null), [[60, true], [64, true]]);
 }
 engine.frame = cutoff + 1000;
 engine.boundary();
 assert.deepEqual(engine.session.tracks[0].notes.map(n => n.midi), [60, 64]);
});

test('during a take, verified events are batched just before the loop boundary', () => {
 const { engine, recorder, advance, hit } = setup('manual', 0.4);
 const loop = 64 * STEP, lead = 0.4 * 44100;
 advance(10 * STEP);
 recorder.addOnsets([hit(2)], 0, CLOCK, engine.frame);
 advance(20 * STEP);
 recorder.addOnsets([hit(25)], 0, CLOCK, engine.frame);
 assert.equal(engine.sent.length, 0, 'held while the loop has time left');
 advance(loop - 30 * STEP - lead + 100);
 recorder.addOnsets([], 0, CLOCK, engine.frame);
 assert.equal(engine.sent.length, 1, 'one batch inside the lead window');
 const op = engine.sent[0].operation;
 assert.ok(op.type === 'commit-performance' && op.events.length === 2);
 engine.boundary();
 assert.deepEqual(kicks(engine.session), [2, 25]);
 // Once the take closes, remaining events are sent without waiting.
 advance(5 * STEP);
 recorder.addOnsets([hit(65)], 0, CLOCK, engine.frame);
 assert.equal(engine.sent.length, 1);
 engine.window.endFrame = engine.frame;
 recorder.handle(engine.transport({ recording: false, recordingState: 'idle' }));
 assert.equal(engine.sent.length, 2);
});
