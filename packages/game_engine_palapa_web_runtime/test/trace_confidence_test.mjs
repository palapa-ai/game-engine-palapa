import assert from 'node:assert/strict';
import test from 'node:test';
import { canPreserveTrace, traceConfidence, traceResolutionConfidence, traceSampleGoal } from '../runtime/hero/trace-confidence.mjs';
import { TraceReveal, TRACE_REVEAL_MS } from '../runtime/hero/trace-reveal.mjs';

test('noisy previews retain a crisp raster contribution at every undersized resolution', () => {
  for (const scale of [0.125, 0.25, 0.5, 1]) {
    const resolution = traceResolutionConfidence({ width: 1024 * scale, height: 1024 * scale }, { width: 1024, height: 1024 });
    assert.equal(resolution, scale ** 2);
    assert.equal(traceConfidence(2, 64, resolution), scale ** 2 / 8);
    assert.equal(traceConfidence(64, 64, resolution), scale ** 2);
  }
  assert.ok(traceConfidence(2, 64, 1 / 64) < 0.002, 'two-sample eighth-size noise contributes less than 0.2%');
  assert.equal(traceConfidence(16, 64, 1), 1);
  assert.equal(traceConfidence(64, 64, 1), 1);
  assert.equal(traceSampleGoal(64), 16);
});

test('actual rounded target dimensions determine the opacity cap', () => {
  assert.ok(Math.abs(traceResolutionConfidence({ width: 12, height: 18 }, { width: 100, height: 145 }) - 216 / 14500) < 1e-15);
  assert.equal(traceResolutionConfidence({ width: 200, height: 300 }, { width: 100, height: 145 }), 1);
  assert.equal(traceResolutionConfidence(null, null), 0);
});

test('explicit low sample choices still finish at full opacity, after each band time fade', () => {
  for (const selectedSamples of [1, 2, 4, 8, 16]) {
    assert.equal(traceConfidence(selectedSamples, selectedSamples, 1), 1);
    const reveal = new TraceReveal();
    reveal.reset(8, 4);
    reveal.observe(selectedSamples, 1000);
    const input = { samples: selectedSamples, selectedSamples, resolutionConfidence: 1, qualitySettled: true };
    assert.equal(canPreserveTrace({ ...input, revealSettled: reveal.settled(1000 + TRACE_REVEAL_MS - 1) }), false);
    assert.equal(canPreserveTrace({ ...input, revealSettled: reveal.settled(1000 + TRACE_REVEAL_MS) }), true);
  }
});

test('weak previews never accumulate recursively into saved history across resets', () => {
  const raster = 1, noisyPixel = 0;
  let history = raster;
  for (let reset = 0; reset < 100; reset++) {
    const quality = { samples: 2, selectedSamples: 64, resolutionConfidence: 1 / 64, qualitySettled: true, revealSettled: true };
    const weight = traceConfidence(quality.samples, quality.selectedSamples, quality.resolutionConfidence);
    const visible = history * (1 - weight) + noisyPixel * weight;
    assert.ok(visible > 0.998);
    if (canPreserveTrace(quality)) history = visible;
  }
  assert.equal(history, raster);
  const quality = { samples: 16, selectedSamples: 64, resolutionConfidence: 1, qualitySettled: true, revealSettled: true };
  assert.equal(canPreserveTrace(quality), true);
  assert.equal(canPreserveTrace({ ...quality, qualitySettled: false }), false);
  assert.equal(canPreserveTrace({ ...quality, samples: 15.99 }), false, 'unfinished rows have not reached the full confidence threshold');
});
