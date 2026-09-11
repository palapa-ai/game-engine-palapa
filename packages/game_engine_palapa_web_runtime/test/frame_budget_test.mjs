import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameBudget, gpuTimer } from '../runtime/hero/frame-budget.mjs';

test('ray work uses remaining total frame time after presentation and GPU reserve', () => {
  const budget = new FrameBudget();
  budget.begin(100);
  assert.equal(budget.allows(103), true);
  budget.paint(8);
  assert.equal(budget.allows(107), false);
  assert.equal(budget.allows(116), false);
  assert.equal(budget.allows(101, true), false);
  assert.equal(budget.milliseconds, 16);
});

test('late animation frames back off ray work and reduce tile area', () => {
  const budget = new FrameBudget({ tiles: 16, maxTiles: 64 });
  budget.begin(0);
  budget.submitted();
  budget.begin(33);
  assert.equal(budget.tiles, 16);
  assert.equal(budget.allows(34), false);
  budget.begin(50);
  assert.equal(budget.allows(51), false);
  budget.begin(67);
  assert.equal(budget.allows(68), true);
  budget.submitted();
  budget.finish(90);
  assert.equal(budget.tiles, 32);
  assert.equal(budget.allows(91), false);
  budget.shrink();
  assert.equal(budget.tiles, 64);
});

test('external 30 Hz cadence lets ray cooldown expire without bypassing GPU backpressure', () => {
  const budget = new FrameBudget();
  budget.begin(0);
  budget.submitted();
  budget.begin(1000 / 30);
  assert.equal(budget.allows(1000 / 30 + 1), false);
  budget.begin(2000 / 30);
  assert.equal(budget.allows(2000 / 30 + 1), false);
  budget.begin(100);
  assert.equal(budget.allows(101, true), false, 'an unfinished GPU query still blocks tracing');
  assert.equal(budget.allows(101), true, 'slow callbacks alone cannot renew an idle cooldown');
  budget.submitted();
  budget.begin(4000 / 30);
  assert.equal(budget.allows(4000 / 30 + 1), false, 'a slow traced frame still triggers backoff');
});

test('GPU timings adapt tiles without waiting for CPU frame overruns', () => {
  const budget = new FrameBudget({ tiles: 16, maxTiles: 64 });
  budget.ray(null, 12, 16);
  assert.equal(budget.tiles, 32);
  assert.equal(budget.rayGpuMs, 3);
  budget.paint(20);
  budget.begin(100);
  assert.equal(budget.allows(101), false);
  for (let index = 0; index < 12; index++) budget.paint(1);
  budget.begin(117);
  assert.equal(budget.allows(118), true);
});

test('sustainable ray work uses available time without needlessly shrinking tiles', () => {
  const budget = new FrameBudget({ tiles: 8 });
  budget.paint(2);
  budget.ray(0.1, 9, 8);
  budget.begin(100);
  assert.equal(budget.tiles, 8);
  assert.equal(budget.allows(100.5), true);
});

test('a hidden or idle page resumes without treating the pause as a slow frame', () => {
  const budget = new FrameBudget();
  budget.begin(0);
  budget.submitted();
  budget.resetCadence();
  budget.begin(4000);
  assert.equal(budget.tiles, 16);
  assert.equal(budget.allows(4001), true);
});

function context({ supported = true } = {}) {
  const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const queries = [], deleted = [], reads = [];
  let disjoint = false;
  return {
    queries, deleted, reads,
    set disjoint(value) { disjoint = value; },
    QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4,
    getExtension: () => supported ? extension : null,
    createQuery() { const query = { available: false, nanoseconds: 3000000 }; queries.push(query); return query; },
    beginQuery() {}, endQuery() {},
    deleteQuery(query) { deleted.push(query); },
    getParameter: () => disjoint,
    getQueryParameter(query, parameter) {
      reads.push(parameter);
      return parameter === this.QUERY_RESULT_AVAILABLE ? query.available : query.nanoseconds;
    },
  };
}

test('GPU timings are polled non-blockingly and retain ray backpressure until available', () => {
  const gl = context(), timer = gpuTimer(gl);
  assert.equal(timer.begin('ray', { tiles: 16 }), true);
  timer.end();
  assert.equal(timer.busy, true);
  assert.deepEqual(timer.poll(), []);
  assert.equal(gl.reads.includes(gl.QUERY_RESULT), false);
  gl.queries[0].available = true;
  const [result] = timer.poll();
  assert.equal(result.kind, 'ray');
  assert.equal(result.tiles, 16);
  assert.equal(result.milliseconds, 3);
  assert.equal(timer.busy, false);
  assert.equal(gl.deleted.length, 1);
  timer.dispose();
});

test('unsupported and disjoint GPU clocks safely release or avoid queries', () => {
  const absent = gpuTimer(context({ supported: false }));
  assert.equal(absent.supported, false);
  assert.equal(absent.begin('ray'), false);
  assert.deepEqual(absent.poll(), []);
  absent.dispose();
  const gl = context(), timer = gpuTimer(gl);
  timer.begin('ray'); timer.end();
  gl.disjoint = true;
  assert.deepEqual(timer.poll(), []);
  assert.equal(gl.reads.includes(gl.QUERY_RESULT), false);
  assert.equal(gl.deleted.length, 1);
  assert.equal(timer.busy, false);
  timer.begin('paint');
  timer.dispose();
  assert.equal(gl.deleted.length, 2);
});

test('GPU measurement backlog reserves a ray slot while keeping all queries bounded', () => {
  const gl = context(), timer = gpuTimer(gl);
  for (let index = 0; index < 4; index++) { timer.begin('paint'); timer.end(); }
  assert.equal(gl.queries.length, 3);
  assert.equal(timer.busy, false);
  assert.equal(timer.begin('ray'), true);
  timer.end();
  assert.equal(timer.busy, true);
  assert.equal(timer.begin('ray'), false);
  assert.equal(timer.begin('paint'), false);
  assert.equal(gl.queries.length, 4);
  timer.dispose();
  assert.equal(gl.deleted.length, 4);
});

test('paint-first frames with delayed queries cannot starve measured ray work', () => {
  const gl = context(), timer = gpuTimer(gl), budget = new FrameBudget();
  for (let frame = 0; frame < 3; frame++) {
    timer.begin('paint'); timer.end();
  }
  for (let frame = 0; frame < 10; frame++) {
    // One completed paint frees a slot each frame, before presentation takes
    // its usual first turn. The reserved fourth slot must remain available.
    const paint = gl.queries.find(query => !gl.deleted.includes(query));
    paint.available = true;
    timer.poll();
    timer.begin('paint'); timer.end();
    budget.begin(frame * 1000 / 60);
    assert.equal(budget.batch(frame * 1000 / 60 + 1, timer.busy), 1);
    assert.equal(timer.begin('ray'), true);
    timer.end();
    assert.equal(timer.busy, true);
    assert.equal(timer.begin('ray'), false);
    assert.ok(gl.queries.length - gl.deleted.length <= 4);
    gl.queries.at(-1).available = true;
    timer.poll();
  }
  timer.dispose();
});


test('full-target blending pressure reduces trace resolution instead of growing tiles forever', () => {
  const budget = new FrameBudget({ tiles: 8, maxTiles: 8 });
  budget.paint(1);
  budget.ray(0.2, 15.11);
  assert.equal(budget.tiles, 8);
  assert.equal(budget.scale, 0.5);
  budget.begin(0);
  assert.equal(budget.allows(1), true);
  budget.submitted();
  budget.ray(0.2, 4, 8, 0.5);
  budget.begin(17);
  assert.equal(budget.allows(18), true);
});

test('a stale expensive estimate cannot permanently starve tracing', () => {
  const budget = new FrameBudget({ tiles: 8, maxTiles: 8 });
  budget.paint(1);
  budget.rayGpuMs = 40;
  let submissions = 0;
  for (let frame = 0; frame < 600; frame++) {
    const now = frame * 1000 / 60;
    budget.begin(now);
    if (!budget.allows(now + 1)) continue;
    submissions++;
    budget.submitted();
    // Measured full-target work after the reduced trace resolution is applied.
    budget.ray(0.1, 15.11 * budget.scale ** 2, budget.tiles, budget.scale);
  }
  assert.ok(submissions > 400);
  assert.ok(budget.tiles <= 8);
  assert.ok(budget.scale < 1);
});

test('minimum-sized work recovers with rate-limited probes, never bypassing paint or pending GPU work', () => {
  const budget = new FrameBudget({ tiles: 8, maxTiles: 8 });
  budget.scale = budget.minScale;
  budget.rayGpuMs = 50;
  const probes = [];
  for (let frame = 0; frame < 180; frame++) {
    const now = frame * 1000 / 60;
    budget.begin(now);
    if (budget.allows(now + 1)) { probes.push(now); budget.submitted(); }
  }
  assert.equal(probes.length, 3);
  assert.ok(probes.slice(1).every((value, index) => value - probes[index] >= 1000));
  budget.begin(4000);
  assert.equal(budget.allows(4001, true), false);
  budget.paint(13);
  budget.begin(5017);
  assert.equal(budget.allows(5018), false);
});

test('GPU timing changes keep CPU submission overhead and recover useful tile throughput', () => {
  const budget = new FrameBudget({ tiles: 8, maxTiles: 8 });
  budget.rayCpuMs = 1;
  budget.shrink();
  assert.equal(budget.rayCpuMs, 1);
  for (let i = 0; i < 64; i++) budget.ray(0.1, 0.1, 8, budget.scale);
  assert.equal(budget.tiles, 4);
  assert.equal(budget.scale, 0.5);
});


test('sustained GPU headroom restores full trace resolution after contention', () => {
  const budget = new FrameBudget({ tiles: 8, maxTiles: 8 });
  budget.scale = budget.minScale;
  for (let i = 0; i < 60; i++) budget.ray(0.1, 0.1, budget.tiles, budget.scale);
  assert.equal(budget.scale, budget.minScale, 'a brief quiet interval must not restart quality');
  for (let i = 0; i < 500; i++) budget.ray(0.1, 0.1, budget.tiles, budget.scale);
  assert.equal(budget.tiles, 2);
  assert.equal(budget.scale, 1);
});

test('explicit quality reset restores requested resolution while retaining measured paint cost', () => {
  const budget = new FrameBudget({ tiles: 8, maxTiles: 8 });
  budget.scale = budget.minScale;
  budget.tiles = 2;
  budget.paint(12);
  budget.resetQuality();
  assert.equal(budget.scale, 1);
  assert.equal(budget.tiles, 8);
  budget.begin(0);
  assert.equal(budget.allows(1), false);
});

function measuredBudget(options = {}) {
  const budget = new FrameBudget({ tiles: 2, maxTiles: 2, ...options });
  budget.ray(0.1, 2);
  budget.ray(0.1, 2);
  return budget;
}

test('batching needs CPU measurements and two completed GPU queries at the current workload', () => {
  const budget = new FrameBudget({ tiles: 2, maxTiles: 2 });
  budget.begin(100);
  assert.equal(budget.batch(100), 1, 'seeded estimates must not enable startup batching');
  budget.ray(0.1, 2);
  assert.equal(budget.batch(100), 1);
  budget.ray(null, 2);
  assert.equal(budget.batch(100), 4);
  assert.equal(budget.batch(100, true), 0, 'pending GPU work always takes precedence');

  const noGpuClock = new FrameBudget({ tiles: 2 });
  noGpuClock.begin(100);
  for (let i = 0; i < 20; i++) noGpuClock.ray(0.01);
  assert.equal(noGpuClock.batch(100), 1, 'CPU submission time cannot stand in for GPU execution time');
  const noCpuMeasurement = new FrameBudget({ tiles: 2 });
  noCpuMeasurement.begin(100);
  noCpuMeasurement.ray(null, 0.1); noCpuMeasurement.ray(null, 0.1);
  assert.equal(noCpuMeasurement.batch(100), 1);
});

test('measured batches spend only the available paint-adjusted frame budget and cap at four bands', () => {
  const budget = measuredBudget();
  budget.begin(100);
  assert.equal(budget.batch(100), 4);
  budget.paint(6);
  assert.equal(budget.batch(101), 2);
  assert.equal(budget.batch(105), 1);
  assert.equal(budget.batch(107), 0);
  budget.cooldown = 1;
  assert.equal(budget.batch(100), 0);
});

test('CPU and GPU batch totals are normalized per actually submitted band', () => {
  const single = new FrameBudget({ tiles: 2, maxTiles: 2 });
  const batched = new FrameBudget({ tiles: 2, maxTiles: 2 });
  single.ray(0.2, 3, 2, 1, 1);
  batched.ray(0.8, 12, 2, 1, 4);
  assert.equal(batched.rayCpuMs, single.rayCpuMs);
  assert.equal(batched.rayGpuMs, single.rayGpuMs);
  assert.equal(batched.tiles, 2, 'a cheap four-band total must not be mistaken for one expensive band');
  const measured = [batched.rayCpuMs, batched.rayGpuMs, batched.batchGpuQueries];
  batched.ray(100, 100, 2, 1, 0);
  assert.deepEqual([batched.rayCpuMs, batched.rayGpuMs, batched.batchGpuQueries], measured, 'zero submitted bands do not poison estimates');
});

test('resets reject old-epoch measurements and require fresh evidence before batching again', () => {
  const budget = measuredBudget();
  budget.begin(100);
  const oldEpoch = budget.measurementEpoch;
  const previousCost = [budget.rayCpuMs, budget.rayGpuMs];
  budget.resetBatchMeasurements();
  assert.ok(budget.measurementEpoch > oldEpoch);
  budget.ray(100, 100, 2, 1, 1, oldEpoch);
  assert.deepEqual([budget.rayCpuMs, budget.rayGpuMs], previousCost);
  assert.equal(budget.batch(100), 1);
  budget.ray(0.1, 2);
  assert.equal(budget.batch(100), 1);
  budget.ray(null, 2);
  assert.equal(budget.batch(100), 4);
  budget.resetCadence(); budget.begin(1000);
  assert.equal(budget.batch(1000), 1, 'resuming after an idle period starts with one measured probe');
  budget.resetQuality(); budget.begin(2000);
  assert.equal(budget.batch(2000), 1);
});

test('tiling changes cannot reuse batching readiness from a different pixel workload', () => {
  const budget = measuredBudget({ maxTiles: 8 });
  budget.begin(100);
  assert.equal(budget.batch(100), 4);
  budget.shrink();
  assert.equal(budget.tiles, 4);
  assert.equal(budget.batch(100), 1);
  budget.ray(0.1, 1, 2, 1);
  budget.ray(0.1, 1, 2, 1);
  assert.equal(budget.batch(100), 1, 'scaled old-tile timings cannot establish current-work readiness');
  budget.ray(0.1, 0.5, 4, 1);
  budget.ray(0.1, 0.5, 4, 1);
  assert.equal(budget.batch(100), 4);
});

test('recovery probes stay one band even after batching was previously measured as safe', () => {
  const budget = new FrameBudget({ tiles: 2, maxTiles: 2 });
  budget.scale = budget.minScale;
  budget.ray(0.1, 2); budget.ray(0.1, 2);
  budget.begin(0);
  assert.equal(budget.batch(0), 4);
  budget.rayGpuMs = 50;
  const batches = [];
  for (let frame = 1; frame < 180; frame++) {
    const time = frame * 1000 / 60;
    budget.begin(time);
    const count = budget.batch(time + 1);
    if (count) { batches.push(count); budget.submitted(); }
  }
  assert.deepEqual(batches, [1, 1, 1]);
});

test('a ray query records its actual batch count and remains the only pending ray query', () => {
  const gl = context(), timer = gpuTimer(gl);
  assert.equal(timer.begin('ray', { tiles: 2, scale: 1, bands: 4, epoch: 7 }), true);
  timer.end({ bands: 2 });
  assert.equal(timer.begin('ray'), false);
  assert.equal(timer.begin('paint'), true, 'presentation timings may still be queued');
  timer.end();
  gl.queries[0].available = true;
  gl.queries[0].nanoseconds = 8000000;
  const [result] = timer.poll();
  assert.equal(result.bands, 2);
  assert.equal(result.epoch, 7);
  assert.equal(result.milliseconds, 8);
  assert.equal(timer.busy, false);
  timer.dispose();
});

test('physical row limits govern work estimates after a resolution downgrade', () => {
  const budget = new FrameBudget({ tiles: 32, maxTiles: 32, minScale: 1 / 64 });
  budget.setViewportHeight(1152);
  budget.scale = 0.125;
  assert.equal(budget.rows, 144);
  budget.rayGpuMs = 8;
  assert.equal(budget.shrink(), true);
  assert.equal(budget.scale, 0.0625);
  assert.equal(budget.rows, 72);
  assert.equal(budget.rayGpuMs, 4, 'a one-pixel band halves in width; its cost does not drop to one quarter');
  assert.equal(budget.tiles, 32, 'requested divisions can remain while effective bands follow target height');
});

test('shrinking never creates empty bands when requested divisions already exceed physical rows', () => {
  const budget = new FrameBudget({ tiles: 16, maxTiles: 32 });
  budget.setViewportHeight(1152);
  budget.scale = 0.125;
  assert.equal(budget.rows, 144);
  assert.equal(budget.shrink(), false, 'doubling requested divisions cannot make a one-pixel band smaller');
  assert.equal(budget.tiles, 16);
  assert.equal(budget.scale, 0.125);
});

test('recovery from one-pixel bands uses a bounded measured stability window', () => {
  const budget = new FrameBudget({ tiles: 32, maxTiles: 32 });
  budget.setViewportHeight(1152);
  budget.scale = 0.125;
  for (let i = 0; i < 63; i++) budget.ray(0.1, 0.1, 32, 0.125, 1, budget.measurementEpoch, 144);
  assert.equal(budget.tiles, 32, 'a brief quiet period retains the conservative partition');
  budget.ray(0.1, 0.1, 32, 0.125, 1, budget.measurementEpoch, 144);
  assert.equal(budget.tiles, 16, '64 useful bands establish recovery without an entire slow sample');
  assert.equal(budget.rows, 144);
  assert.ok(budget.rayGpuMs < 0.2, 'halving divisions with the same effective rows must not quadruple the cost');
});

test('coarsening estimates actual merged pixel area without multiplying CPU submission overhead', () => {
  const budget = new FrameBudget({ tiles: 32, maxTiles: 32 });
  budget.setViewportHeight(1154);
  budget.scale = 0.5;
  budget.paint(1.79);
  assert.equal(budget.rows, 577);
  for (let i = 0; i < 64; i++) budget.ray(0.9, 1.65, 32, 0.5, 1, budget.measurementEpoch, 577);
  assert.equal(budget.tiles, 16, 'the measured 577-to-256 partition fits the frame budget');
  assert.equal(budget.rows, 256);
  assert.ok(Math.abs(budget.rayCpuMs - 0.9) < 1e-12);
  assert.ok(budget.rayGpuMs > 3.7 && budget.rayGpuMs < 3.8);
  for (let i = 0; i < 128; i++) budget.ray(0.9, 3.72, 16, 0.5, 1, budget.measurementEpoch, 256);
  assert.equal(budget.tiles, 16, 'the next larger partition would exceed the remaining frame budget');
  assert.equal(budget.scale, 0.5);
});

test('changing viewport height invalidates old queries and measured batching readiness', () => {
  const budget = measuredBudget();
  budget.begin(100);
  assert.equal(budget.batch(100), 4);
  const epoch = budget.measurementEpoch;
  budget.setViewportHeight(3);
  assert.equal(budget.rows, 3);
  assert.equal(budget.batch(100), 1);
  const cost = budget.rayGpuMs;
  budget.ray(null, 100, 2, 1, 1, epoch, 4);
  assert.equal(budget.rayGpuMs, cost);
  budget.ray(0.1, 2, 2, 1, 1, budget.measurementEpoch, 3);
  budget.ray(0.1, 2, 2, 1, 1, budget.measurementEpoch, 3);
  assert.equal(budget.batch(100), 4);
});
