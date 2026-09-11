import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLatitudeRow } from '../runtime/capacity/map-texture.mjs';

test('historical Mercator rows preserve the equator and graticule boundaries', () => {
  assert.equal(mapLatitudeRow(80, -60, 80), 0);
  assert.equal(mapLatitudeRow(-60, -60, 80), 1);
  assert.ok(Math.abs(mapLatitudeRow(0, -80, 80) - 0.5) < 1e-12);
  assert.ok(Math.abs(mapLatitudeRow(60, -80, 80) - 0.2297) < 0.0001);
  assert.equal(mapLatitudeRow(90, -60, 80), null);
  assert.equal(mapLatitudeRow(-90, -60, 80), null);
});
