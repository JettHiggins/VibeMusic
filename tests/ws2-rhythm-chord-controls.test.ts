import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionCommand } from '@voicesynth/contracts';
import { moveNote } from '../apps/web/src/ui/pattern-edit.ts';
import { GRID_OPTIONS, chordBlocked, chordHint, chordOf, gridHint, rhythmOf } from '../apps/web/src/ui/recording-settings.ts';
import { emptyTracker, trackTake } from '../apps/web/src/ui/recording-phase.ts';

test('missing settings read as the contract defaults; every grid option is a valid command', () => {
 assert.equal(rhythmOf({}), 'sixteenth');
 assert.equal(chordOf({}), 'off');
 assert.equal(rhythmOf({ rhythmSnap: 'quarter' }), 'quarter');
 for (const o of GRID_OPTIONS) SessionCommand.parse({ id: 'c', expectedRevision: 1, boundary: 'immediate', operation: { type: 'set-rhythm-snap', grid: o.value } });
 for (const mode of ['off', 'triad'] as const) SessionCommand.parse({ id: 'c', expectedRevision: 1, boundary: 'immediate', operation: { type: 'set-chord-mode', mode } });
 assert.deepEqual(GRID_OPTIONS.map(o => o.label), ['1/16', '1/8', '1/4']);
});

test('grid hint explains the trade-off and that a change during a take applies to the next take', () => {
 assert.match(gridHint('sixteenth', null), /quick pairs kept/);
 assert.match(gridHint('quarter', null), /merge onto the same beat/);
 assert.match(gridHint('eighth', 'eighth'), /nearest eighth notes/);
 assert.equal(gridHint('quarter', 'sixteenth'), 'This take keeps 1/16; 1/4 applies from the next take.');
 const t = { clockId: 'c', sampleRate: 48000, currentFrame: 0, loopStartFrame: 0, playing: true, recording: true, pendingCommandIds: [], recordingState: 'recording' as const, recordingStartFrame: 10, recordingEpoch: 1 };
 const r = { mode: 'manual' as const, capturing: true, provisional: [], live: null, timing: [], committed: 0, dropped: 0, lastError: null, inFlight: null };
 const take = trackTake(emptyTracker, t, r, 'sixteenth');
 assert.equal(trackTake(take, t, r, 'quarter').grid, 'sixteenth', 'grid in force at take start is kept for the take');
});

test('chord mode is synth-only and its hint follows the key', () => {
 assert.equal(chordBlocked('drums', true), 'Chords apply to sung synth notes; select a synth');
 assert.equal(chordBlocked('synth-1', false), 'Enable audio first');
 assert.equal(chordBlocked('synth-2', true), null);
 assert.match(chordHint('triad', { root: 2, scale: 'minor' }), /D minor triads/);
 assert.match(chordHint('triad', null), /major triads/);
 assert.equal(chordHint('off', null), 'New sung notes stay single notes.');
});

test('moving a chord note moves its chord tones and drops pitches pushed out of range', () => {
 const p = { notes: [{ id: 'a', step: 0, duration: 4, midi: 60, velocity: 0.8, chord: [64, 67] }], hits: [] };
 assert.deepEqual(moveNote('a', 4, 62)(p, () => 'x').notes[0], { id: 'a', step: 4, duration: 4, midi: 62, velocity: 0.8, chord: [66, 69] });
 assert.deepEqual(moveNote('a', 0, 122)(p, () => 'x').notes[0].chord, [126], 'only in-range tones remain');
 const high = moveNote('a', 0, 127)(p, () => 'x').notes[0];
 assert.equal(high.chord, undefined, 'all tones out of range leaves a single note');
 assert.equal(moveNote('a', 1, 60)({ notes: [{ id: 'a', step: 0, duration: 4, midi: 60, velocity: 0.8 }], hits: [] }, () => 'x').notes[0].chord, undefined);
});
