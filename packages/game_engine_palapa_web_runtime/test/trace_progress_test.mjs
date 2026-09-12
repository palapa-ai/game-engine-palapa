import assert from 'node:assert/strict';
import test from 'node:test';
import { traceProgress, traceProgressText } from '../runtime/hero/trace-progress.mjs';

const finalPass = { samples: 2, targetSamples: 64, state: 'tracing', stage: 'background', scale: 1, bounces: 4, targetBounces: 4, meshCount: 10 };

test('final quality reports completed samples against the final Auto or selected target', () => {
  assert.deepEqual(traceProgress(finalPass), { percent: 3.1, refining: false });
  assert.equal(traceProgress({ ...finalPass, samples: 0.5 }).percent, 0.7);
  assert.equal(traceProgress({ ...finalPass, samples: 32 }).percent, 50);
  assert.equal(traceProgress({ ...finalPass, samples: 0.5, targetSamples: 1 }).percent, 50);
  assert.equal(traceProgress({ ...finalPass, samples: 1, targetSamples: 4 }).percent, 25);
  assert.equal(traceProgress({ ...finalPass, samples: 128, targetSamples: 1024 }).percent, 12.5);
});

test('preview resolution and bounce passes cannot count as final-quality progress', () => {
  for (const state of ['tracing', 'complete']) {
    for (const scale of [0.125, 0.5, 0.999]) {
      assert.deepEqual(traceProgress({ ...finalPass, state, samples: 128, scale }), { percent: 0, refining: true });
    }
    for (const bounces of [1, 2]) {
      assert.deepEqual(traceProgress({ ...finalPass, state, samples: 128, bounces }), { percent: 0, refining: true });
    }
    assert.deepEqual(traceProgress({ ...finalPass, state, samples: 128, stage: 'foreground' }), { percent: 0, refining: true });
  }
});

test('the final reveal must finish before either final stage reports 100 percent', () => {
  for (const stage of ['background', 'text']) {
    for (const samples of [63.99999, 64, 128]) {
      assert.equal(traceProgress({ ...finalPass, stage, samples }).percent, 99.9);
    }
    assert.equal(traceProgress({ ...finalPass, stage, samples: 63.99999, state: 'complete' }).percent, 99.9);
    assert.equal(traceProgress({ ...finalPass, stage, samples: 64, state: 'complete' }).percent, 100);
    assert.equal(traceProgress({ ...finalPass, stage, samples: 128, state: 'complete' }).percent, 100);
  }
});

test('scene or view resets and unavailable tracing cannot retain a previous completed percentage', () => {
  for (const state of ['starting', 'loading', 'fallback', 'raster']) {
    assert.deepEqual(traceProgress({ ...finalPass, samples: 64, state }), { percent: 0, refining: false });
  }
  assert.equal(traceProgress({ ...finalPass, samples: 0 }).percent, 0);
  assert.equal(traceProgress({ ...finalPass, samples: 0, scale: 0.5 }).percent, 0);
});

test('empty worlds finish without samples, after scene preparation completes', () => {
  const empty = { samples: 0, targetSamples: 64, meshCount: 0 };
  assert.deepEqual(traceProgress({ ...empty, state: 'loading' }), { percent: 0, refining: false });
  assert.deepEqual(traceProgress({ ...empty, state: 'complete' }), { percent: 100, refining: false });
});

test('independent worlds use their own sample and quality targets', () => {
  assert.equal(traceProgress({ ...finalPass, samples: 4, targetSamples: 8 }).percent, 50);
  assert.equal(traceProgress({ ...finalPass, samples: 4, targetSamples: 64 }).percent, 6.2);
  assert.equal(traceProgress({ ...finalPass, samples: 4, targetBounces: 8 }).percent, 0);
});

test('invalid or missing sample goals cannot claim completion', () => {
  for (const targetSamples of [0, -1, NaN, Infinity, undefined]) {
    assert.equal(traceProgress({ ...finalPass, state: 'complete', targetSamples }).percent, 0);
  }
  for (const samples of [-1, NaN, Infinity, undefined]) {
    assert.equal(traceProgress({ ...finalPass, state: 'complete', samples }).percent, 0);
  }
});


test('shared scene progress appears once with either or both visibility controls enabled', () => {
  const source = { samples: 0.06, state: 'tracing' };
  const bricks = { source, label: 'Ray trace bricks' };
  const content = { source, label: 'Ray trace content' };
  for (const enabled of [[bricks, content], [bricks], [content]]) {
    assert.equal(traceProgressText(enabled), '0% · 0.06 spp · refining');
  }
  assert.equal(traceProgressText([]), '');
});

test('distinct renderers retain separate progress and labels even with identical values', () => {
  const sources = Array.from({ length: 2 }, () => ({
    samples: 32, state: 'tracing', renderer: { domElement: { dataset: {
      traceTargetSamples: '64', traceStage: 'text', traceResolutionScale: '1',
      traceBounces: '4', traceTargetBounces: '4', traceMeshCount: '10',
    } } },
  }));
  const traces = sources.map((source, index) => ({ source, label: `Ray trace ${['bricks', 'content'][index]}` }));
  assert.equal(traceProgressText(traces), '50% · 32 spp · bricks\n50% · 32 spp · content');
  sources[1].samples = 16;
  assert.equal(traceProgressText(traces), '50% · 32 spp · bricks\n25% · 16 spp · content');
});
