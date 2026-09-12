import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry } from '../runtime/hero/vendor/three.module.min.js';
import { MeshBVH } from '../runtime/hero/vendor/three-mesh-bvh.module.js';
import { BvhBuild } from '../runtime/hero/bvh-build.mjs';
import { attachTracer } from '../runtime/hero/tracer.mjs';

function worker() {
  return { terminated: 0, postMessage() {}, terminate() { this.terminated++; } };
}

test('cancelling a pending build rejects its promise and releases its worker exactly once', async () => {
  const source = worker(), builder = new BvhBuild(source), geometry = new BoxGeometry();
  const pending = builder.generate(geometry);
  builder.dispose(); builder.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(builder.generate(geometry), { name: 'AbortError' });
  assert.equal(source.terminated, 1);
  assert.equal(source.onmessage, null);
  assert.equal(source.onerror, null);
  assert.equal(builder.pending, null);
  geometry.dispose();
});

test('invalid worker output and failed dispatch settle instead of leaving a build pending', async () => {
  const source = worker(), builder = new BvhBuild(source), geometry = new BoxGeometry();
  const pending = builder.generate(geometry);
  source.onmessage({ data: { serialized: { roots: null }, position: null } });
  await assert.rejects(pending);
  assert.equal(builder.pending, null);
  source.postMessage = () => { throw new Error('Could not transfer buffer'); };
  await assert.rejects(builder.generate(geometry), /Could not transfer buffer/);
  assert.equal(source.onmessage, null);
  assert.equal(builder.pending, null);
  builder.dispose(); geometry.dispose();
});

test('successful worker builds reconstruct the actual BVH and remain reusable', async () => {
  const source = worker(), builder = new BvhBuild(source), geometry = new BoxGeometry();
  const serialized = MeshBVH.serialize(new MeshBVH(geometry));
  for (let attempt = 0; attempt < 2; attempt++) {
    const pending = builder.generate(geometry);
    source.onmessage({ data: { serialized, position: geometry.attributes.position.array } });
    const result = await pending;
    assert.ok(result instanceof MeshBVH);
    assert.ok(geometry.boundingBox);
    assert.equal(source.onmessage, null);
  }
  builder.dispose(); geometry.dispose();
});

test('an already replaced scene never starts allocating a tracer', async () => {
  const controller = new AbortController();
  controller.abort();
  const renderer = new Proxy({}, { get() { assert.fail('cancelled builds must not access the renderer'); } });
  await assert.rejects(attachTracer(renderer, null, null, { signal: controller.signal }), { name: 'AbortError' });
});
