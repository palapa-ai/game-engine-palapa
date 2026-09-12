import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../runtime/hero/vendor/three.module.min.js';
import { prepareTraceBackdrop } from '../runtime/hero/trace-backdrop.mjs';
import { TraceReveal, TRACE_REVEAL_MS } from '../runtime/hero/trace-reveal.mjs';

function fixture() {
  const scene = new THREE.Scene();
  const backdrop = new THREE.Group();
  backdrop.userData.traceRole = 'backdrop';
  const map = new THREE.Texture();
  const original = new THREE.MeshStandardMaterial({ map });
  const geometry = new THREE.BoxGeometry();
  const back = new THREE.Mesh(geometry, original);
  const back2 = new THREE.Mesh(geometry, [original, original]);
  backdrop.add(back, back2);
  const nestedContent = new THREE.Mesh(geometry, original);
  nestedContent.userData.traceRole = 'content';
  backdrop.add(nestedContent);
  const content = new THREE.Mesh(geometry, original);
  scene.add(backdrop, content);
  return { scene, original, geometry, map, back, back2, content, nestedContent };
}

test('foreground stage retains all geometry and clones only explicitly classified backdrop materials', () => {
  const f = fixture();
  const before = []; f.scene.traverse(object => before.push(object));
  const stage = prepareTraceBackdrop(f.scene, true);
  const after = []; f.scene.traverse(object => after.push(object));
  assert.deepEqual(after, before, 'all geometry remains available for secondary rays');
  assert.equal(stage.hasBackdrop, true);
  assert.notEqual(f.back.material, f.original);
  assert.equal(f.back.material.matte, true);
  assert.equal(f.back.material.map, f.map);
  assert.equal(f.back.geometry, f.geometry);
  assert.equal(f.back2.material[0], f.back.material);
  assert.equal(f.back2.material[1], f.back.material, 'retain shared material instances');
  assert.equal(f.content.material, f.original);
  assert.equal(f.nestedContent.material, f.original, 'explicit nested content overrides inherited backdrop role');
  assert.equal(f.original.matte, undefined, 'source material remains unchanged');
  assert.equal(stage.setForegroundOnly(false), true);
  assert.equal(f.back.material.matte, false);
  assert.equal(stage.setForegroundOnly(false), false, 'same stage does not require a material update/reset');
  assert.equal(stage.setForegroundOnly(true), true);
  assert.equal(f.back.material.matte, true);
  stage.dispose();
});

test('owned backdrop clones are released once without disposing original maps/materials or later replacements', () => {
  const f = fixture();
  const stage = prepareTraceBackdrop(f.scene, true);
  let sourceDisposals = 0, mapDisposals = 0, cloneDisposals = 0;
  f.original.addEventListener('dispose', () => sourceDisposals++);
  f.map.addEventListener('dispose', () => mapDisposals++);
  f.back.material.addEventListener('dispose', () => cloneDisposals++);
  const replacement = new THREE.MeshStandardMaterial();
  f.back.material = replacement;
  stage.dispose(); stage.dispose();
  assert.equal(cloneDisposals, 1);
  assert.equal(sourceDisposals, 0);
  assert.equal(mapDisposals, 0);
  assert.equal(f.back.material, replacement, 'do not overwrite a later caller edit');
  assert.deepEqual(f.back2.material, [f.original, f.original]);
});

test('existing matte semantics survive leaving the foreground stage', () => {
  const f = fixture();
  f.original.matte = true;
  const stage = prepareTraceBackdrop(f.scene, true);
  stage.setForegroundOnly(false);
  assert.equal(f.back.material.matte, true);
  stage.dispose();
});

test('first-result timestamps reveal uneven bands independently and do not restart for later samples', () => {
  const reveal = new TraceReveal();
  reveal.reset(7, 4);
  assert.deepEqual([...reveal.data], [-1, -1, -1, -1, -1, -1, -1]);
  assert.equal(reveal.observe(0, 1000), false);
  assert.equal(reveal.observe(0.25, 1000), true);
  assert.deepEqual([...reveal.data], [-1, -1, -1, -1, -1, 1, 1]);
  reveal.observe(0.5, 1200);
  assert.deepEqual([...reveal.data], [...new Float32Array([-1, -1, -1, 1.2, 1.2, 1, 1])]);
  reveal.observe(1, 1500);
  const times = [...reveal.data];
  assert.equal(reveal.settled(1500 + TRACE_REVEAL_MS - 1), false, 'last band needs its entire fade even when samples are done');
  assert.equal(reveal.settled(1500 + TRACE_REVEAL_MS), true);
  assert.equal(reveal.observe(4, 8000), false);
  assert.deepEqual([...reveal.data], times, 'additional samples do not flash the reveal again');
});

test('scroll/scale/stage resets erase coverage and support more bands than target rows', () => {
  const reveal = new TraceReveal();
  reveal.reset(2, 8);
  for (let tile = 1; tile <= 8; tile++) reveal.observe(tile / 8, tile * 1000);
  assert.deepEqual([...reveal.data], [5, 1], 'only the two nonempty physical bands have pixels');
  assert.equal(reveal.settled(8000), true);
  reveal.reset(2, 8);
  assert.deepEqual([...reveal.data], [-1, -1]);
  assert.equal(reveal.settled(9000), false);
  reveal.reset(4, 2);
  assert.deepEqual([...reveal.data], [-1, -1, -1, -1]);
  assert.throws(() => reveal.reset(0, 4), RangeError);
});

test('backdrop cache draws only the clean backdrop and restores visibility/renderer state after errors', async () => {
  const { BackdropCache } = await import('../runtime/hero/backdrop-cache.mjs');
  const cache = new BackdropCache();
  const f = fixture();
  const hidden = new THREE.Mesh(f.geometry, f.original);
  hidden.visible = false;
  f.scene.add(hidden);
  const previousTarget = {};
  let draws = 0, fail = false;
  const renderer = {
    target: previousTarget, autoClear: false,
    getRenderTarget() { return this.target; },
    setRenderTarget(target) { this.target = target; },
    render(scene) {
      draws++;
      assert.equal(scene, f.scene);
      assert.equal(this.target, cache.target);
      assert.equal(this.autoClear, true);
      assert.equal(f.content.visible, false);
      assert.equal(f.nestedContent.visible, false);
      assert.equal(f.back.visible, true);
      assert.equal(hidden.visible, false);
      if (fail) throw Error('render failure');
    },
  };
  cache.resize(640, 480);
  assert.equal(cache.target.width, 640);
  assert.equal(cache.target.height, 480);
  const foreground = [f.content, f.nestedContent, hidden];
  cache.refresh(renderer, f.scene, new THREE.Camera(), foreground);
  fail = true;
  assert.throws(() => cache.refresh(renderer, f.scene, new THREE.Camera(), foreground), /render failure/);
  assert.equal(draws, 2, 'one backdrop draw per cache refresh');
  assert.equal(renderer.target, previousTarget);
  assert.equal(renderer.autoClear, false);
  assert.equal(f.content.visible, true);
  assert.equal(f.nestedContent.visible, true);
  assert.equal(hidden.visible, false);
  let releases = 0;
  cache.target.addEventListener('dispose', () => releases++);
  cache.dispose(); cache.dispose();
  assert.equal(releases, 1, 'release the backdrop color/depth allocation once');
});
