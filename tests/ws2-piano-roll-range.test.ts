import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CENTER, MIN_CENTER, followCenter, offRange, rangeSide, visibleRows } from '../apps/web/src/ui/piano-roll-geometry.ts';

test('notes outside the visible rows are reported by side, nearest first', () => {
 const rows = visibleRows(60); // C3 (48) .. C5 (72)
 assert.equal(rangeSide(72, rows), null);
 assert.equal(rangeSide(48, rows), null);
 assert.equal(rangeSide(73, rows), 'above');
 assert.equal(rangeSide(43, rows), 'below');
 const off = offRange([{ midi: 43 }, { midi: 60 }, { midi: 36 }, { midi: 84 }, { midi: 74 }], rows);
 assert.deepEqual(off.above.map(n => n.midi), [74, 84]);
 assert.deepEqual(off.below.map(n => n.midi), [43, 36]);
});

test('following a sung note moves by whole octaves and leaves margin from the edge', () => {
 assert.equal(followCenter(60, 60), 60, 'visible notes do not move the view');
 const low = followCenter(60, 43); // G2
 assert.equal((60 - low) % 12, 0);
 const lowRows = visibleRows(low);
 assert.ok(43 <= lowRows[0] - 2 && 43 >= lowRows[lowRows.length - 1] + 2, `G2 inside ${low}`);
 const high = followCenter(60, 88); // E6
 assert.equal((high - 60) % 12, 0);
 assert.ok(visibleRows(high).includes(88));
 assert.equal(followCenter(60, 0), MIN_CENTER, 'clamped at the bottom octave');
 assert.ok(visibleRows(MIN_CENTER).includes(0));
 assert.equal(followCenter(60, 127), MAX_CENTER, 'clamped at the top octave');
 assert.ok(visibleRows(MAX_CENTER).includes(127));
 // Each sung vocal-range pitch ends up visible from the default view.
 for (let midi = 36; midi <= 96; midi++) assert.ok(visibleRows(followCenter(60, midi)).includes(midi), `midi ${midi}`);
});
