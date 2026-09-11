import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../runtime/hero/vendor/three.module.min.js';
import { normalizeTraceViewport, sameTraceViewport, traceViewportSize, applyTraceViewport } from '../runtime/hero/trace-viewport.mjs';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('viewport clips to the full buffer and includes fractional edge pixels', () => {
  assert.deepEqual(normalizeTraceViewport({ left: -4, top: 100.2, width: 404.2, height: 200.1, fullWidth: 800, fullHeight: 1200 }),
    { left: 0, top: 100, width: 401, height: 201, fullWidth: 800, fullHeight: 1200 });
  assert.equal(normalizeTraceViewport(null), null);
  assert.throws(() => normalizeTraceViewport({ left: 0, top: 1300, width: 800, height: 100, fullWidth: 800, fullHeight: 1200 }), RangeError);
  assert.throws(() => normalizeTraceViewport({ left: 0, top: 0, width: 800, height: 0, fullWidth: 800, fullHeight: 1200 }), RangeError);
});

test('target size follows viewport and adaptive scale, never full document height', () => {
  const viewport = { left: 0, top: 400, width: 1392, height: 784, fullWidth: 1392, fullHeight: 2154 };
  assert.deepEqual(traceViewportSize(viewport, 0.25), { width: 348, height: 196 });
  assert.deepEqual(traceViewportSize(viewport, 1), { width: 1392, height: 784 });
  assert.deepEqual(traceViewportSize(viewport, 1, 696), { width: 696, height: 392 });
  assert.deepEqual(traceViewportSize({ width: 1, height: 1 }, 1 / 64), { width: 1, height: 1 });
});

test('orthographic crop projects the selected document region without changing the source camera', () => {
  const source = new THREE.OrthographicCamera(-640, 640, 0, -1980, 0.1, 10000);
  source.position.z = 2000;
  source.updateMatrixWorld();
  const projection = source.projectionMatrix.clone();
  const camera = source.clone();
  const viewport = { left: 348, top: 718, width: 696, height: 718, fullWidth: 1392, fullHeight: 2154 };
  applyTraceViewport(camera, source, viewport);
  const topLeft = new THREE.Vector3(-320, -660, 0).project(camera);
  const bottomRight = new THREE.Vector3(320, -1320, 0).project(camera);
  close(topLeft.x, -1); close(topLeft.y, 1);
  close(bottomRight.x, 1); close(bottomRight.y, -1);
  assert.ok(source.projectionMatrix.equals(projection));
  assert.equal(source.view, null);
  applyTraceViewport(camera, source, null);
  assert.ok(camera.projectionMatrix.equals(projection));
});

test('scrolling changes only the cloned camera crop and size changes are detectable', () => {
  const source = new THREE.OrthographicCamera(-400, 400, 0, -1600, 0.1, 10000);
  const camera = source.clone();
  const first = { left: 0, top: 0, width: 800, height: 400, fullWidth: 800, fullHeight: 1600 };
  const next = { ...first, top: 400 };
  applyTraceViewport(camera, source, first);
  close(new THREE.Vector3(0, -200, 0).project(camera).y, 0);
  applyTraceViewport(camera, source, next);
  close(new THREE.Vector3(0, -600, 0).project(camera).y, 0);
  assert.equal(sameTraceViewport(first, { ...first }), true);
  assert.equal(sameTraceViewport(first, next), false);
  assert.equal(sameTraceViewport(null, null), true);
  assert.equal(sameTraceViewport(first, null), false);
});
