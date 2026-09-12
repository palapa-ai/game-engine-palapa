import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameCadence } from '../runtime/hero/frame-cadence.mjs';

for (const hz of [30, 60, 90, 120, 144, 240]) {
  test(`${hz} Hz callbacks submit no more than 60 frames per second`, () => {
    const cadence = new FrameCadence();
    for (let frame = 0; frame < hz * 10; frame++) cadence.accept(frame * 1000 / hz);
    assert.ok(cadence.frames <= 600);
    assert.ok(cadence.frames >= Math.min(hz, 60) * 10 - 1);
  });
}

test('a stalled frame does not cause a burst of catch-up rendering', () => {
  const cadence = new FrameCadence();
  assert.equal(cadence.accept(0), true);
  assert.equal(cadence.accept(5000), true);
  for (let ms = 1; ms < 16; ms++) assert.equal(cadence.accept(5000 + ms), false);
  assert.equal(cadence.accept(5017), true);
});

test('resuming resets the deadline while preserving actual frame totals', () => {
  const cadence = new FrameCadence();
  cadence.accept(0);
  cadence.reset();
  assert.equal(cadence.accept(1000), true);
  assert.equal(cadence.frames, 2);
});
