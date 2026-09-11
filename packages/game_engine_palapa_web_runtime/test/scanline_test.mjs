import test from 'node:test';
import assert from 'node:assert/strict';
import { scanlineCoverage } from '../runtime/hero/scanline.mjs';

test('each completed band exposes only the pixels traced from the top', () => {
  for (const height of [768, 1001, 2047]) {
    for (const rows of [4, 16, 64]) {
      for (let completed = 0; completed <= rows; completed++) {
        const coverage = scanlineCoverage(completed / rows, height, rows);
        const expectedPixels = height - Math.floor(height * (rows - completed) / rows);
        assert.equal(Math.round(coverage * height), expectedPixels);
      }
      assert.ok(scanlineCoverage(1 / rows, height, rows) > 0);
      assert.equal(scanlineCoverage(2.5, height, rows), 1);
    }
  }
});

test('resetting or resizing never exposes unfinished pixels', () => {
  assert.equal(scanlineCoverage(0, 1001, 64), 0);
  assert.equal(scanlineCoverage(0.5 / 64, 1001, 64), 0);
  assert.equal(scanlineCoverage(1 / 64, 0, 64), 0);
  assert.equal(scanlineCoverage(1 / 64, 1001, 0), 0);
});

import { ProgressiveTrace } from '../runtime/hero/progressive-trace.mjs';

test('quality starts with one bounce and only advances after complete passes', () => {
  for (const target of [1, 2, 4, 8]) {
    const trace = new ProgressiveTrace(target);
    assert.equal(trace.bounces, 1);
    assert.equal(trace.advance(0.99), false);
    while (!trace.settled) {
      const previous = trace.bounces;
      assert.equal(trace.advance(1), true);
      assert.equal(trace.bounces, previous * 2);
    }
    assert.equal(trace.bounces, target);
    assert.equal(trace.advance(64), false);
  }
});
