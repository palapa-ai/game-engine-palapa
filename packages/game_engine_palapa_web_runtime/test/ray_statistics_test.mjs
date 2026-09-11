import test from 'node:test';
import assert from 'node:assert/strict';
import { RayStatistics } from '../runtime/hero/ray-statistics.mjs';

test('ray totals combine independent worlds without double counting the primary source', () => {
  const content = { cameraRays: 250 }, bricks = { cameraRays: 100 };
  const stats = new RayStatistics([content, bricks, content, undefined], 0);
  assert.deepEqual(stats.read(0), { total: 350, perSecond: 0 });
  content.cameraRays += 500;
  bricks.cameraRays += 50;
  assert.deepEqual(stats.read(1000), { total: 900, perSecond: 550 });
  content.samples = 0;
  content.state = bricks.state = 'raster';
  assert.deepEqual(stats.read(2000), { total: 900, perSecond: 0 });
});

test('rates use elapsed time, update once per second, and return to zero when idle', () => {
  const source = { cameraRays: 0 };
  const stats = new RayStatistics([source], 0);
  source.cameraRays = 500;
  assert.deepEqual(stats.read(250), { total: 500, perSecond: 0 });
  assert.deepEqual(stats.read(2000), { total: 500, perSecond: 250 });
  assert.deepEqual(stats.read(3000), { total: 500, perSecond: 0 });
  source.cameraRays += 100;
  assert.deepEqual(stats.read(13000), { total: 600, perSecond: 10 });
});
