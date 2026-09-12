import assert from 'node:assert/strict';
import test from 'node:test';
import { traceError, traceStatus } from '../runtime/hero/trace-failure.mjs';

test('render failures retain the original exception and identify the failing operation', () => {
  const original = new RangeError('Invalid typed array length: 96');
  const error = traceError(original, 'Scene build');
  assert.equal(error.cause, original);
  assert.equal(error.message, 'Scene build failed: RangeError: Invalid typed array length: 96');
  assert.match(traceError('Context lost', 'Sampling').message, /Sampling failed: Context lost/);
});

test('Debug shows the actual failure once for a shared world and clears it while retrying', () => {
  const source = {
    state: 'fallback',
    renderer: { domElement: { dataset: { traceFailure: 'Sampling failed: RangeError: buffer too small' } } },
  };
  const traces = [{ source }, { source }];
  assert.equal(traceStatus(traces), 'Ray tracing unavailable\nSampling failed: RangeError: buffer too small');
  assert.equal(traceStatus([]), 'Ray tracing off');
  source.state = 'loading';
  assert.equal(traceStatus(traces), 'Preparing ray tracing…', 'an old failure does not describe a new attempt');
  source.state = 'tracing';
  assert.equal(traceStatus(traces), '');
});
