import assert from 'node:assert/strict';
import test from 'node:test';
import { ProgressiveResolution } from '../runtime/hero/progressive-resolution.mjs';

test('coarse previews refine toward the requested resolution before spending 64 samples', () => {
  const policy = new ProgressiveResolution();
  const observed = { samples: 4, scale: 0.125, tiles: 8, now: 1000, targetSamples: 64 };
  assert.equal(policy.advance({ ...observed, samples: 3.99 }), null);
  assert.deepEqual(policy.advance(observed), { scale: 0.25, tiles: 16 });
  assert.equal(policy.advance({ ...observed, scale: 0.25, tiles: 16, samples: 0.5 }), null);
  assert.deepEqual(policy.advance({ ...observed, scale: 0.25, tiles: 16 }), { scale: 0.5, tiles: 32 });
  assert.deepEqual(policy.advance({ ...observed, scale: 0.5, tiles: 32 }), { scale: 1, tiles: 32 });
  assert.equal(policy.advance({ ...observed, scale: 1, tiles: 32 }), null);
  assert.equal(policy.complete({ samples: 64, scale: 0.125, targetSamples: 64 }), false);
  assert.equal(policy.complete({ samples: 63, scale: 1, targetSamples: 64 }), false);
  assert.equal(policy.complete({ samples: 64, scale: 1, targetSamples: 64 }), true);
});

test('reported preview sample target respects a user request below four samples', () => {
  const policy = new ProgressiveResolution();
  assert.equal(policy.sampleTarget(0.25, 64), 4);
  assert.equal(policy.sampleTarget(1, 64), 64);
  assert.equal(policy.sampleTarget(0.25, 1), 1);
  assert.deepEqual(policy.advance({ samples: 1, scale: 0.5, tiles: 4, now: 0, targetSamples: 1 }), {
    scale: 1, tiles: 8,
  });
  assert.equal(policy.complete({ samples: 1, scale: 0.5, targetSamples: 1 }), false);
  assert.equal(policy.complete({ samples: 1, scale: 1, targetSamples: 1 }), true);
});

test('failed measured attempts back off without falsely completing the coarse result', () => {
  const policy = new ProgressiveResolution();
  const coarse = { samples: 4, scale: 0.125, tiles: 8, now: 0, targetSamples: 64 };
  assert.deepEqual(policy.advance(coarse), { scale: 0.25, tiles: 16 });
  let now = 100;
  const delays = [2000, 4000, 8000, 16000, 30000, 30000];
  for (const delay of delays) {
    assert.equal(policy.advance({ ...coarse, now }), null, 'a downgrade schedules a later probe');
    assert.equal(policy.nextRetryAt, now + delay);
    assert.equal(policy.advance({ ...coarse, samples: 100, now: now + delay - 1 }), null);
    assert.equal(policy.complete({ samples: 100, scale: coarse.scale, targetSamples: 64 }), false);
    now += delay;
    assert.deepEqual(policy.advance({ ...coarse, now }), { scale: 0.25, tiles: 16 });
    now += 100;
  }
  assert.deepEqual(policy.advance({ ...coarse, scale: 0.25, tiles: 16, now }), { scale: 0.5, tiles: 32 });
  assert.equal(policy.failedAttempts, 0, 'a stable higher-resolution preview clears failure history');
});

test('a non-power-of-two target is reached without overshooting its scale or tile limit', () => {
  const policy = new ProgressiveResolution({ targetScale: 0.75, maxTiles: 12 });
  assert.deepEqual(policy.advance({ samples: 4, scale: 0.5, tiles: 8, now: 0, targetSamples: 64 }), {
    scale: 0.75, tiles: 12,
  });
  assert.equal(policy.advance({ samples: 64, scale: 0.75, tiles: 12, now: 1000, targetSamples: 64 }), null);
  assert.equal(policy.complete({ samples: 64, scale: 0.75, targetSamples: 64 }), true);
});
