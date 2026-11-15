import assert from 'node:assert/strict';
import test from 'node:test';
import { updateHeardSpeech, type HeardSpeech } from '../apps/web/src/ui/voice-feedback.ts';
const interpreting: HeardSpeech = { type: 'speech-transcript', utteranceId: 'voice-1', clockId: 'capture', startFrame: 10, endFrame: 100, text: 'Groove, find a warm piano', outcome: 'interpreting' };

test('singing and unrelated responses do not finish or replace pending voice feedback', () => {
 assert.equal(updateHeardSpeech(interpreting, { ...interpreting, utteranceId: 'singing', outcome: 'ignored' }), interpreting);
 assert.equal(updateHeardSpeech(interpreting, { type: 'error', requestId: 'voice-10', message: 'Other request failed' }), interpreting);
});
test('the matching research job replaces interpretation feedback without claiming completion', () => {
 const next = updateHeardSpeech(interpreting, { type: 'research-context', requestId: 'voice-1', jobId: 'new-job', trackId: 'synth-1', description: 'warm piano', origin: 'voice' });
 assert.equal(next?.outcome, 'research');
 assert.equal(next?.text, interpreting.text);
});
test('matching provider refusal ends interpretation; a later unrelated response cannot overwrite it', () => {
 const failed = updateHeardSpeech(interpreting, { type: 'error', requestId: 'voice-1', message: 'Quota reached' });
 assert.equal(failed?.outcome, 'refused');
 assert.equal(failed?.detail, 'Quota reached');
 assert.equal(updateHeardSpeech(failed, { type: 'error', requestId: 'voice-1', message: 'Late message' }), failed);
});
