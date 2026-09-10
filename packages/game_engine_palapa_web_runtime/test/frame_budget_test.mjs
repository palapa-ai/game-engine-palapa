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

test('GPU measurement backlog is bounded and prevents further ray submissions', () => {
  const gl = context(), timer = gpuTimer(gl);
  for (let index = 0; index < 4; index++) { timer.begin('paint'); timer.end(); }
  assert.equal(timer.busy, true);
  assert.equal(timer.begin('ray'), false);
  assert.equal(gl.queries.length, 4);
  timer.dispose();
  assert.equal(gl.deleted.length, 4);
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
