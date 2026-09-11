import assert from 'node:assert/strict';
import test from 'node:test';
import { TraceHistory } from '../runtime/hero/trace-history.mjs';
import { canPreserveTrace, traceConfidence } from '../runtime/hero/trace-confidence.mjs';

function fixture() {
  const state = new TraceHistory(), targets = [null, null], raster = [1, 1, 1];
  const source = index => index < 0 ? raster : targets[index];
  return {
    state, targets, raster,
    get visible() { return source(state.sourceIndex); },
    capture(color, weight, pixels = [0, 1, 2], transient = false) {
      state.capture((targetIndex, sourceIndex) => {
        assert.notEqual(targetIndex, sourceIndex, 'never sample the target being written');
        targets[targetIndex] = source(sourceIndex).map((value, index) =>
          pixels.includes(index) ? value * (1 - weight) + color * weight : value);
      }, { transient });
    },
  };
}

test('the foreground result survives the switch to a zero-sample backdrop pass', () => {
  const f = fixture();
  const quality = { samples: 4, selectedSamples: 64, resolutionConfidence: 0.25, qualitySettled: true, revealSettled: true };
  assert.equal(canPreserveTrace(quality), false, 'the foreground is still too coarse for trusted history');
  const weight = traceConfidence(quality.samples, quality.selectedSamples, quality.resolutionConfidence);
  f.capture(0, weight, [0], true);
  const before = [...f.visible];
  assert.deepEqual(before, [0.9375, 1, 1]);
  assert.equal(f.state.trustedIndex, -1);
  assert.deepEqual(f.visible, before, 'starting or resetting backdrop sampling retains the foreground base');
});

test('foreground captures cannot recursively amplify weak noise, even when replaced before completion', () => {
  const f = fixture();
  for (let reset = 0; reset < 100; reset++) {
    f.capture(0, 0.0625, [0], true);
    assert.deepEqual(f.visible, [0.9375, 1, 1]);
    assert.equal(f.state.trustedIndex, -1);
  }
  f.state.clearTransient();
  assert.deepEqual(f.visible, f.raster, 'scroll/manual resets drop only the temporary preview');
});

test('trusted completion replaces the transient region and retains earlier offscreen history', () => {
  const f = fixture();
  f.capture(0.2, 1, [0]);
  const trusted = f.state.trustedIndex;
  f.capture(0, 0.0625, [1], true);
  assert.notEqual(f.state.sourceIndex, trusted);
  assert.deepEqual(f.visible, [0.2, 0.9375, 1]);
  f.capture(0.4, 1, [1]);
  assert.equal(f.state.transientIndex, -1);
  assert.deepEqual(f.visible, [0.2, 0.4, 1]);
  f.state.clearTransient();
  assert.deepEqual(f.visible, [0.2, 0.4, 1], 'trusted pixels survive future viewport resets');
  f.state.reset();
  assert.deepEqual(f.visible, f.raster, 'a geometry rebuild discards all old imagery');
});

test('failed history draws do not advance ownership to an incomplete target', () => {
  const f = fixture();
  f.capture(0.3, 1);
  const sourceIndex = f.state.sourceIndex;
  assert.throws(() => f.state.capture(() => { throw Error('draw failed'); }, { transient: true }), /draw failed/);
  assert.equal(f.state.sourceIndex, sourceIndex);
  assert.equal(f.state.transientIndex, -1);
  f.capture(0, 0.0625, [1], true);
  assert.throws(() => f.state.capture(() => { throw Error('replace failed'); }, { transient: true }), /replace failed/);
  assert.deepEqual(f.visible, [0.3, 0.3, 0.3], 'a partially overwritten transient falls back to trusted history');
  f.capture(0, 0.0625, [1], true);
  assert.throws(() => f.state.capture(() => { throw Error('trusted draw failed'); }), /trusted draw failed/);
  assert.equal(f.state.trustedIndex, -1, 'a partially overwritten trusted target is invalidated');
  f.state.clearTransient();
  assert.deepEqual(f.visible, f.raster);
});
