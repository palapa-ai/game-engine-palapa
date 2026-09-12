import assert from 'node:assert/strict';
import test from 'node:test';
import { brickCourse } from '../runtime/background/brick-scene.mjs';

test('brick dimensions stay fixed as the viewport becomes wider', () => {
  const layout = { minimumWidth: 320, courseFraction: 0.042 };
  const expected = brickCourse(layout);
  assert.ok(Math.abs(expected - 13.44) < Number.EPSILON * 64);
  for (const width of [320, 640, 1440, 3840]) {
    assert.equal(brickCourse({ ...layout, viewportWidth: width }), expected);
  }
});
