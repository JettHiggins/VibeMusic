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
  return { type: 'transport', transport: { clockId: CLOCK, sampleRate: 44100, currentFrame: this.frame, loopStartFrame: START, playing: true, recording: this.window.endFrame === null, recordingState: this.window.endFrame === null ? 'recording' : 'idle', recordingStartFrame: START, recordingTarget: this.window.target, recordingEpoch: 1, pendingCommandIds: this.queued.map(c => c.id), ...overrides } };
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

test('targeted erase fences remove only matching old and delayed melody while retaining unrelated provisional notes', () => {
 const { engine, recorder, advance } = melodic();
 advance(5 * STEP);
 recorder.addNotes([note(6, 10, 60), note(12, 16, 65)], 0, CLOCK, engine.frame);
 assert.deepEqual(recorder.status().provisional.map(p => p.step), [6, 12]);
 const fence = { commandId: 'erase-1', recordingEpoch: 1, throughFrame: Math.round(START + 10 * STEP), target: { trackId: 'synth-1' as const }, step: 8 };
 recorder.handle(engine.transport({ captureErasure: fence }));
 assert.deepEqual(recorder.status().provisional.map(p => p.step), [12]);
 recorder.addNotes([note(7, 9, 62), note(20, 24, 67)], 0, CLOCK, engine.frame);
 assert.deepEqual(recorder.status().provisional.map(p => p.step), [12, 20], 'late old note is fenced, new unrelated note survives');
 assert.equal(recorder.status().dropped, 2);
});

test('targeted erase keeps the same in-flight command and surviving event IDs', () => {
 const { engine, recorder, advance, hit } = setup();
 advance(20 * STEP);
 recorder.addOnsets([hit(3), hit(12)], 0, CLOCK, engine.frame);
 const command = engine.sent[0];
 assert.ok(command.operation.type === 'commit-performance' && command.operation.events.length === 2);
 const fence = { commandId: 'erase-queued', recordingEpoch: 1, throughFrame: hit(3).frame, target: { trackId: 'drums' as const, lane: 'kick' as const }, step: 3 };
 recorder.handle(engine.transport({ captureErasure: fence }));
 assert.equal(recorder.status().inFlight, command.id);
 assert.deepEqual(recorder.status().provisional.map(p => [p.step, p.status]), [[12, 'submitted']]);
 assert.equal(engine.sent.length, 1, 'erasure does not submit survivors as a new batch');
 engine.ack(command, 'applied');
 assert.equal(recorder.status().committed, 1);
 assert.equal(recorder.status().lastError, null);
});

test('terminal rejection of an all-erased batch is quiet and does not count erased events twice', () => {
 const { engine, recorder, advance, hit } = setup();
 advance(20 * STEP);
 recorder.addOnsets([hit(3)], 0, CLOCK, engine.frame);
 const command = engine.sent[0];
 recorder.handle(engine.transport({ captureErasure: { commandId: 'erase-all', recordingEpoch: 1, throughFrame: hit(3).frame, target: { trackId: 'drums', lane: 'kick' }, step: 3 } }));
 assert.equal(recorder.status().dropped, 1);
 engine.ack(command, 'rejected', 'All events erased');
 assert.equal(recorder.status().dropped, 1);
 assert.equal(recorder.status().lastError, null);
 assert.equal(recorder.status().inFlight, null);
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

test('sung notes verified later in a loop replace the queued batch and land at the same boundary', () => {
 const { engine, recorder, advance } = melodic();
 advance(10 * STEP);
 recorder.addNotes([note(0, 4, 60)], 0, CLOCK, engine.frame);
 advance(20 * STEP);
 recorder.addNotes([note(8, 12, 62), note(16, 24, 67)], 0, CLOCK, engine.frame);
 const last = engine.sent.at(-1)!.operation;
 assert.ok(last.type === 'commit-performance' && last.events.length === 3 && last.replacesCommandId === engine.sent[0].id, 'superset replaces the queued batch');
 assert.equal(engine.queued.length, 1);
 engine.boundary();
 assert.deepEqual(engine.session.tracks[0].notes.map(x => [x.step, x.duration, x.midi]), [[0, 4, 60], [8, 4, 62], [16, 8, 67]]);
 assert.equal(recorder.status().committed, 3);
 assert.equal(recorder.status().lastError, null);
});

test('a replaced batch that the audio thread already applied is counted, not resubmitted (async acks)', () => {
 // Like BrowserEngine: dispatch only posts to the audio thread and returns a submission receipt;
 // authoritative acks and snapshots come back later, possibly after the recorder sent a replacement.
 const engine = new FakeEngine();
 engine.window = { ...engine.window, target: { trackId: 'synth-1' } };
 const inbox: SessionCommand[] = [], outbox: ClientMessage[] = [];
 engine.listeners.push(m => outbox.push(m));
 let n = 0;
 const recorder = new PerformanceRecorder({ dispatch: c => { inbox.push(c); return { type: 'ack', commandId: c.id, status: 'queued', revision: 0 }; }, newId: () => `a${++n}` }, 'manual', { batchLeadSeconds: Infinity });
 const audioThread = () => inbox.splice(0).forEach(c => engine.dispatch(c));
 const deliver = () => outbox.splice(0).forEach(m => recorder.handle(m));
 recorder.handle({ type: 'session', session: engine.session });
 const advance = (frames: number) => { engine.frame += frames; recorder.handle(engine.transport()); };
 advance(10 * STEP);
 recorder.addNotes([note(0, 4, 60)], 0, CLOCK, engine.frame);
 audioThread(); deliver(); // A queued
 engine.boundary(); // A applied; its ack and snapshot are still in transit
 advance(10 * STEP);
 recorder.addNotes([note(8, 12, 62)], 0, CLOCK, engine.frame); // replacement B sent before A's ack arrives
 audioThread(); deliver(); // applied(A), session, rejected(B: no longer queued)
 for (let i = 0; i < 3; i++) { audioThread(); engine.boundary(); deliver(); }
 assert.deepEqual(engine.session.tracks[0].notes.map(x => x.midi).sort(), [60, 62]);
 assert.equal(recorder.status().lastError, null);
 assert.equal(recorder.status().inFlight, null);
 assert.equal(recorder.status().provisional.length, 0);
 assert.equal(recorder.status().committed, 2, 'A counted once, B resubmitted without A');
 const resent = engine.sent.filter(c => c.operation.type === 'commit-performance').at(-1)!.operation;
 assert.ok(resent.type === 'commit-performance' && resent.events.every(e => e.kind === 'note' && e.midi === 62), 'already-applied events are not resubmitted');
});

test('a new take does not chain onto an unacknowledged batch from the previous take', () => {
 const engine = new FakeEngine();
 let n = 0;
 const recorder = new PerformanceRecorder({ dispatch: c => ({ type: 'ack', commandId: c.id, status: 'queued', revision: 0 }), newId: () => `s${++n}` }, 'manual', { batchLeadSeconds: Infinity }); // engine never answers
 recorder.handle({ type: 'session', session: engine.session });
 engine.frame += 10 * STEP; recorder.handle(engine.transport());
 recorder.addOnsets([{ frame: Math.round(START + 2 * STEP), velocity: 0.8, confidence: 0.9, levelDb: -12 }], 0, CLOCK, engine.frame);
 assert.ok(recorder.status().inFlight);
 // Next take: new window start, nothing pending in the engine.
 const next = START + 128 * STEP;
 engine.frame = next + 4 * STEP;
 recorder.handle(engine.transport({ recordingStartFrame: next, pendingCommandIds: [] }));
 assert.equal(recorder.status().inFlight, null);
 assert.equal(recorder.status().provisional.length, 0);
 assert.match(recorder.status().lastError ?? '', /not acknowledged/);
 const sent: SessionCommand[] = [];
 const r2 = new PerformanceRecorder({ dispatch: c => { sent.push(c); return { type: 'ack', commandId: c.id, status: 'queued', revision: 0 }; }, newId: () => `t${++n}` }, 'manual', { batchLeadSeconds: Infinity });
 r2.handle({ type: 'session', session: engine.session });
 r2.handle(engine.transport({ recordingStartFrame: next, pendingCommandIds: [] }));
 r2.addOnsets([{ frame: Math.round(next + 2 * STEP), velocity: 0.8, confidence: 0.9, levelDb: -12 }], 0, CLOCK, engine.frame);
 const op = sent[0].operation;
 assert.ok(op.type === 'commit-performance' && !op.replacesCommandId);
});

test('epoch reset forgets queued/replaced batches, rejects late results, and tags fresh mid-loop input', () => {
 const {engine,recorder,advance,hit}=setup();
 advance(20*STEP);
 recorder.handle(engine.transport({recordingEpoch:1,recordingLoopStartFrame:START-4*STEP}));
 recorder.addOnsets([hit(2)],0,CLOCK,engine.frame);
 recorder.addOnsets([hit(3)],0,CLOCK,engine.frame);
 const old=engine.sent.slice(),cutoff=engine.frame+1;
 recorder.handle(engine.transport({recordingEpoch:2,captureStartFrame:cutoff,recordingLoopStartFrame:START-4*STEP}));
 assert.equal(recorder.status().inFlight,null);
 assert.equal(recorder.status().provisional.length,0);
 for(const c of old)recorder.handle({type:'ack',commandId:c.id,status:'rejected',revision:0,reason:'Stale revision'});
 assert.equal(engine.sent.length,old.length,'old terminal acks do not retry');
 recorder.addOnsets([hit(3)],0,CLOCK,engine.frame);
 recorder.addNotes([{startFrame:START,endFrame:cutoff+100,midi:60,confidence:1,velocity:1}],0,CLOCK,cutoff+100);
 assert.equal(engine.sent.length,old.length,'late pre-edit audio does not return');
 engine.frame=cutoff+STEP;
 recorder.handle(engine.transport({recordingEpoch:2,captureStartFrame:cutoff,recordingLoopStartFrame:START-4*STEP}));
 recorder.addOnsets([{...hit(0),frame:engine.frame-100}],0,CLOCK,engine.frame);
 const last=engine.sent.at(-1)!;
 assert.ok(last.operation.type==='commit-performance');
 assert.equal(last.operation.recordingEpoch,2);
 assert.equal(last.operation.replacesCommandId,undefined);
 assert.equal(recorder.status().provisional[0].step,25,'grid follows composition origin rather than take start');
 assert.equal(recorder.status().lastError,null,'intentional cancellation is quiet');
});

test('clear after stop resets the retained window too',()=>{
 const {engine,recorder,advance,hit}=setup();advance(20*STEP);
 recorder.handle(engine.transport({recordingEpoch:1}));
 engine.window.endFrame=engine.frame;
 recorder.handle(engine.transport({recordingEpoch:1}));
 recorder.handle(engine.transport({recordingEpoch:2,captureStartFrame:engine.frame+1}));
 recorder.addOnsets([hit(4)],0,CLOCK,engine.frame);
 assert.equal(engine.sent.length,0);
});

test('losing speech keeps notes it had already verified and still commits them (playtest: melodies vanished)', () => {
 // A batch lead of 1 s means nothing submits until the loop boundary is near.
 const { engine, recorder, advance, hit } = setup('speech', 1);
 recorder.setSpeechAvailable(true);
 advance(20 * STEP);
 recorder.addOnsets([hit(2), hit(6), hit(15)], 0, CLOCK, engine.frame);
 recorder.verifyThrough(CLOCK, START + 10 * STEP); // hits at 2 and 6 classified; 15 not yet
 assert.equal(engine.sent.length, 0, 'far from the boundary: verified hits wait');
 recorder.setSpeechAvailable(false); // e.g. a capture gap or a dropped service connection
 assert.equal(recorder.status().provisional.length, 2, 'verified hits survive; only the unverified one is dropped');
 advance(43 * STEP); // reach the batch lead before the loop boundary
 const op = engine.sent[0]?.operation;
 assert.ok(op?.type === 'commit-performance', 'verified hits still commit while speech is down');
 if (op?.type === 'commit-performance') assert.equal(op.events.length, 2);
});
