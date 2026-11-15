import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Transport } from '@voicesynth/contracts';
import type { RecorderStatus } from '../apps/web/src/input/recorder.ts';
import { currentTake, emptyTracker, framePosition, recordingPhase, trackTake } from '../apps/web/src/ui/recording-phase.ts';

const SR = 48000, BEAT = SR / 2; // 120 BPM
const t = (over: Partial<Transport> = {}): Transport => ({ clockId: 'c', sampleRate: SR, currentFrame: 0, loopStartFrame: 0, playing: false, recording: false, pendingCommandIds: [], ...over });
const r = (over: Partial<RecorderStatus> = {}): RecorderStatus => ({ mode: 'manual', capturing: false, provisional: [], live: null, timing: [], committed: 0, dropped: 0, lastError: null, inFlight: null, ...over });
const ev = (status: 'provisional' | 'submitted') => ({ event: {} as never, step: 0, duration: 1, status });

test('frame positions map to 1-based bar and beat in the four-bar loop', () => {
 assert.deepEqual(framePosition(0, t(), 120), { step: 0, bar: 1, beat: 1 });
 assert.deepEqual(framePosition(BEAT * 5, t(), 120), { step: 20, bar: 2, beat: 2 });
 assert.deepEqual(framePosition(BEAT * 16, t(), 120), { step: 0, bar: 1, beat: 1 }, 'wraps at four bars');
 assert.equal(framePosition(-1, t(), 120), null, 'before the loop origin');
});

test('phase explains stopped, playing, count-in, next-beat arming and recording', () => {
 assert.equal(recordingPhase(t(), 120, 'Synth 1').detail, 'Record plays a one-bar count-in first.');
 const playing = recordingPhase(t({ playing: true, currentFrame: BEAT * 6 }), 120, 'Synth 1');
 assert.equal(playing.headline, 'Bar 2, beat 3');
 const countIn = recordingPhase(t({ playing: true, recordingState: 'armed', countInBeatsRemaining: 3, currentFrame: BEAT, armedStartFrame: BEAT * 4 }), 120, 'Synth 1');
 assert.equal(countIn.headline, 'Count-in 3');
 assert.equal(countIn.beatsToStart, 3);
 assert.deepEqual(countIn.start, { bar: 2, beat: 1 });
 assert.equal(countIn.detail, 'Get ready: Synth 1 records from bar 2, beat 1.');
 const nextBeat = recordingPhase(t({ playing: true, recordingState: 'armed', currentFrame: BEAT * 6.5, armedStartFrame: BEAT * 7 }), 120, 'Synth 2');
 assert.equal(nextBeat.headline, 'Starts in 1 beat');
 assert.deepEqual(nextBeat.start, { bar: 2, beat: 4 });
 const noFrame = recordingPhase(t({ playing: true, recordingState: 'armed' }), 120, 'Drums');
 assert.equal(noFrame.detail, 'Get ready: Drums records from the next beat.', 'no invented start position');
 const rec = recordingPhase(t({ playing: true, recording: true, recordingState: 'recording', currentFrame: BEAT * 9 }), 120, 'Drums');
 assert.equal(rec.headline, 'Recording · bar 3, beat 2');
 assert.equal(rec.detail, 'Drums are recording; beatbox now.');
});

test('take feedback counts per take, follows the verification mode and only reports real reasons', () => {
 const take1 = t({ recording: true, recordingState: 'recording', recordingStartFrame: 1000, recordingEpoch: 1 });
 let tr = trackTake(emptyTracker, take1, r({ committed: 7, dropped: 2 }));
 const before = r({ mode: 'speech', committed: 9, dropped: 3, provisional: [ev('provisional'), ev('provisional'), ev('submitted')] });
 tr = trackTake(tr, take1, before);
 const f = currentTake(before, tr);
 assert.deepEqual([f.waiting, f.sent, f.saved, f.notKept], [2, 1, 2, 1], 'counts since this take started');
 assert.equal(f.waitingLabel, 'waiting for speech check');
 assert.equal(f.reason, null, 'a dropped count alone never produces a reason');
 // Undo/Clear during the take advances the epoch inside the same take.
 tr = trackTake(tr, { ...take1, recordingEpoch: 2 }, r({ mode: 'speech', committed: 9, dropped: 3 }));
 assert.equal(currentTake(r({ committed: 9, dropped: 3 }), tr).reason, 'Undo/Clear restarted capture; 3 unsaved entries were discarded. Counts restart here.');
 assert.equal(currentTake(r({ committed: 10, dropped: 3 }), tr).saved, 1, 'saved counts restart with capture, since Undo may remove saved notes');
 // The recorder's own error wins.
 assert.equal(currentTake(r({ committed: 9, dropped: 5, lastError: 'Speech recognition disconnected; unverified hits were discarded' }), tr).reason, 'Speech recognition disconnected; unverified hits were discarded');
 // A new take starts clean.
 const next = trackTake(tr, { ...take1, recordingStartFrame: 99000, recordingEpoch: 3 }, r({ committed: 9, dropped: 3 }));
 assert.deepEqual([currentTake(r({ committed: 9, dropped: 3 }), next).saved, currentTake(r({ committed: 9, dropped: 3 }), next).reason], [0, null]);
 assert.equal(currentTake(r(), trackTake(next, null, r())).saved, 0, 'a new microphone session rebases instead of going negative');
});
