import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../runtime/hero/vendor/three.module.min.js';
import { PhysicalPathTracingMaterial, WebGLPathTracer } from '../runtime/hero/vendor/three-gpu-pathtracer.module.js';

function disposed(resource) {
  let count = 0;
  resource.addEventListener('dispose', () => count++);
  return () => count;
}

function ownedAllocations(material) {
  const resources = new Set([
    material.attributesArray, material.materialIndexAttribute, material.materials,
    material.lights.tex, material.stratifiedTexture, material.stratifiedOffsetTexture,
    material.envMapInfo.map, material.envMapInfo.marginalWeights, material.envMapInfo.conditionalWeights,
    material.bvh.index, material.bvh.position, material.bvh.bvhBounds, material.bvh.bvhContents,
  ]);
  // Texture-array uniforms expose the texture, but the allocation to release is
  // its owning render target (including the copy quad's shader material).
  for (const resource of material._ownedResources) {
    if (!resource.isRenderTarget) continue;
    resources.add(resource);
    resources.add(resource.fsQuad.material);
  }
  assert.equal(resources.size, 17);
  return [...resources].map(resource => [resource, disposed(resource)]);
}

function expectReleased(allocations) {
  for (const [resource, count] of allocations) {
    assert.equal(count(), 1, `${resource.constructor.name} should release its owned allocation exactly once`);
  }
}

test('disposing a tracer releases owned GPU uniform allocations across repeated rebuilds', () => {
  const source = new THREE.DataTexture(new Float32Array([0.2, 0.4, 0.6, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  const sourceDisposed = disposed(source);
  const sobol = new THREE.Texture();
  const sobolDisposed = disposed(sobol);
  for (let rebuild = 0; rebuild < 5; rebuild++) {
    const material = new PhysicalPathTracingMaterial();
    material.envMapInfo.updateFrom(source);
    assert.notEqual(material.envMapInfo.map, source, 'environment sampler owns a converted copy');
    material.backgroundMap = source;
    material.sobolTexture = sobol;
    const allocations = ownedAllocations(material);
    const quad = () => ({ material: new THREE.ShaderMaterial(), dispose() {} });
    const tracer = Object.assign(Object.create(WebGLPathTracer.prototype), {
      _quad: quad(),
      _pathTracer: { material, _blendQuad: quad(), dispose() {} },
      _lowResPathTracer: { material, _blendQuad: quad(), dispose() {} },
    });
    tracer.dispose();
    material.dispose(); // A shared low-resolution material must remain safe to release again.
    expectReleased(allocations);
    assert.equal(sourceDisposed(), 0, 'scene environment/background source remains owned by its caller');
    assert.equal(sobolDisposed(), 0, 'Sobol target remains owned by the renderer');
  }
});

test('caller-supplied maps never become material-owned allocations', () => {
  const sharedTexture = new THREE.Texture();
  const sharedDisposed = disposed(sharedTexture);
  const material = new PhysicalPathTracingMaterial({ textures: sharedTexture, backgroundMap: sharedTexture });
  const ownedTargets = [...material._ownedResources].filter(resource => resource.isRenderTarget);
  const released = ownedTargets.map(disposed);
  assert.equal(ownedTargets.length, 2);
  material.dispose();
  assert.deepEqual(released.map(count => count()), [1, 1], 'release default owned arrays even if uniforms were replaced');
  assert.equal(sharedDisposed(), 0);
});
