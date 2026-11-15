import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWorkerLoadError } from '../apps/web/src/input/worker-load-error.ts';

test('microphone worker load errors include the failed URL and source location', () => {
 const message = formatWorkerLoadError({
  message: 'Failed to load module script',
  filename: 'http://127.0.0.1:5173/src/input/analysis-worker.ts',
  lineno: 18,
  colno: 7,
 });
 assert.match(message, /Failed to load module script/);
 assert.match(message, /http:\/\/127\.0\.0\.1:5173\/src\/input\/analysis-worker\.ts:18:7/);
 assert.match(message, /Restart npm run dev/);
});

test('microphone worker load errors keep a useful fallback when browsers omit details', () => {
 const message = formatWorkerLoadError({ message: '', filename: '', lineno: 0, colno: 0 });
 assert.equal(message, 'Microphone analysis failed to load. Restart npm run dev and reload the page; if it persists, run npm ci.');
 assert.doesNotMatch(message, /undefined/);
});
