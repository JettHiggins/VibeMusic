import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../packages/contracts/src/index.ts';
import { exportSession, importSession, listSaved, loadLocal, saveLocal } from '../apps/web/src/persistence/session-file.ts';
import { loadCalibration, saveCalibration } from '../apps/web/src/persistence/calibration-store.ts';

class Memory { data = new Map<string, string>(); getItem(k: string) { return this.data.get(k) ?? null; } setItem(k: string, v: string) { this.data.set(k, v); } }
function demo() {
 const s = createSession(); s.tempo = 132; s.revision = 9;
 s.tracks[3].hits.push({ id: 'k', step: 0, lane: 'kick', velocity: 0.9 });
 s.tracks[0].notes.push({ id: 'n', step: 60, duration: 8, midi: 64, velocity: 0.7 });
 return s;
}

test('export/import round-trips the session exactly', () => {
 const session = demo();
 const file = importSession(exportSession(session, 'Groove 1', new Date('2026-11-14T00:00:00Z')));
 assert.deepEqual(file.session, session);
 assert.equal(file.name, 'Groove 1');
 assert.equal(file.savedAt, '2026-11-14T00:00:00.000Z');
});

test('bare SessionState JSON and the shared fixture import', () => {
 assert.deepEqual(importSession(JSON.stringify(demo())).session, demo());
 const fixture = readFileSync('packages/contracts/fixtures/SessionState.json', 'utf8');
 assert.equal(importSession(fixture).session.version, 1);
});

test('invalid, foreign and future files are rejected with a reason', () => {
 assert.throws(() => importSession('{oops'), /JSON/);
 assert.throws(() => importSession('{"hello":1}'), /Not a VoiceSynthesizer/);
 assert.throws(() => importSession(JSON.stringify({ format: 'voicesynth-session', formatVersion: 2, session: demo() })), /version 2/);
 const bad = demo(); (bad.tracks[3].hits[0] as { step: number }).step = 64;
 assert.throws(() => importSession(exportSessionUnchecked(bad)), /invalid/);
 const dup = demo(); dup.tracks[1].id = 'synth-1';
 assert.throws(() => importSession(exportSessionUnchecked(dup)), /duplicate/);
});
function exportSessionUnchecked(session: unknown) { return JSON.stringify({ format: 'voicesynth-session', formatVersion: 1, savedAt: '', name: 'x', session }); }

test('local saves list newest first, overwrite by name, and survive a corrupt entry', () => {
 const store = new Memory();
 saveLocal(demo(), 'A', store, new Date('2026-01-01'));
 saveLocal(createSession(), 'B', store, new Date('2026-01-02'));
 saveLocal(demo(), 'A', store, new Date('2026-01-03'));
 assert.deepEqual(listSaved(store).map(s => s.name), ['A', 'B']);
 assert.deepEqual(loadLocal('A', store).session, demo());
 const raw = JSON.parse(store.getItem('voicesynth.sessions.v1')!); raw.push({ junk: true }); store.setItem('voicesynth.sessions.v1', JSON.stringify(raw));
 assert.equal(listSaved(store).length, 2);
 assert.throws(() => loadLocal('C', store), /No saved session/);
});

test('calibration is stored per device and ignores malformed entries', () => {
 const store = new Memory();
 const calibration = { version: 1 as const, noiseFloorDb: -55, peakDb: null, latencyFrames: 4000, latencySource: 'tap-along' as const, latencySpreadFrames: 100, sampleRate: 44100, deviceId: 'mic-1' };
 saveCalibration(calibration, store);
 assert.deepEqual(loadCalibration('mic-1', store), calibration);
 assert.equal(loadCalibration('mic-2', store), null);
 store.setItem('voicesynth.input-calibration.v1', '{"mic-1":{"version":1,"noiseFloorDb":"loud"}}');
 assert.equal(loadCalibration('mic-1', store), null);
});
