import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../runtime/hero/vendor/three.module.min.js';
import { PathTracingSceneGenerator } from '../runtime/hero/vendor/three-gpu-pathtracer.module.js';
import { createPalm } from '../runtime/geometry/palm.mjs';
import { cloneTraceScene } from '../runtime/hero/trace-scene.mjs';

test('palm greens survive the real trace generator alongside uncolored bark', () => {
  const palm = createPalm({ coconuts: 0, canopyDepth: 2.2, facets: [
    { color: '#8bf000', points: [[-2, 0.4, 0.05], [-1.4, 1.15, -0.1], [-0.4, 1.16, -0.25], [-1.4, 0.25, 0.35]] },
    { color: '#086200', points: [[0.4, 2.3, -0.4], [2.13, 2.03, -0.6], [1.23, 1.89, -0.3]] },
  ] });
  const leaf = palm.children.find(mesh => mesh.material?.vertexColors);
  const original = leaf.geometry.attributes.color;
  const trace = cloneTraceScene(palm, 'scene');
  const result = new PathTracingSceneGenerator(trace.scene).generate();
  const color = result.geometry.attributes.color;
  const materials = result.geometry.attributes.materialIndex;
  let leafVertices = 0;
  for (let index = 0; index < color.count; index++) {
    if (!result.materials[materials.getX(index)].vertexColors) continue;
    leafVertices++;
    assert.ok(color.getY(index) > color.getX(index), 'green remains the dominant channel');
    assert.equal(color.getZ(index), 0);
    assert.equal(color.getW(index), 1, 'opaque leaves never inherit a neighboring RGB component as alpha');
  }
  assert.equal(leafVertices, original.count);
  assert.equal(leaf.geometry.attributes.color, original);
  assert.equal(original.itemSize, 3, 'raster geometry is unchanged');
  assert.equal(leaf.material.emissiveIntensity, 1);
  assert.equal(leaf.material.emissive.getHex(), 0, 'leaves still rely on physical lighting');
  trace.dispose(); result.geometry.dispose();
});

test('material groups normalize byte RGB colors while preserving explicit RGBA', () => {
  const geometry = new THREE.BoxGeometry();
  const count = geometry.attributes.position.count;
  const rgb = new Uint8Array(count * 3);
  for (let index = 0; index < count; index++) rgb.set([32, 192, 0], index * 3);
  geometry.setAttribute('color', new THREE.Uint8BufferAttribute(rgb, 3, true));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, Array(6).fill(material)));
  const trace = cloneTraceScene(root, 'scene');
  const result = new PathTracingSceneGenerator(trace.scene).generate();
  const color = result.geometry.attributes.color;
  for (let index = 0; index < color.count; index++) {
    assert.ok(Math.abs(color.getX(index) - 32 / 255) < 1e-7);
    assert.ok(Math.abs(color.getY(index) - 192 / 255) < 1e-7);
    assert.equal(color.getW(index), 1);
  }
  const explicit = new THREE.Float32BufferAttribute(new Float32Array(count * 4).fill(0.25), 4);
  geometry.setAttribute('color', explicit);
  const rgbaTrace = cloneTraceScene(new THREE.Mesh(geometry, material), 'scene');
  assert.equal(rgbaTrace.scene.geometry.attributes.color, explicit);
  rgbaTrace.dispose(); trace.dispose(); result.geometry.dispose(); geometry.dispose(); material.dispose();
});

test('scene rebuilding cannot overflow color buffers when a colored mesh sorts first', () => {
  for (const first of [true, false]) {
    const geometry = new THREE.BoxGeometry();
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(
      new Float32Array(geometry.attributes.position.count * 3).fill(0.5), 3));
    const material = new THREE.MeshStandardMaterial({ vertexColors: true });
    const plain = new THREE.MeshStandardMaterial();
    const uncoloredGeometry = new THREE.BoxGeometry();
    const root = new THREE.Group();
    const colored = new THREE.Mesh(geometry, material); colored.name = 'colored';
    const uncolored = new THREE.Mesh(uncoloredGeometry, plain); uncolored.name = 'uncolored';
    root.add(colored, uncolored);
    const trace = cloneTraceScene(root, 'scene');
    trace.scene.getObjectByName('colored').uuid = first ? 'aaa' : 'zzz';
    trace.scene.getObjectByName('uncolored').uuid = first ? 'zzz' : 'aaa';
    const result = new PathTracingSceneGenerator(trace.scene).generate();
    assert.equal(result.geometry.attributes.color.itemSize, 4);
    assert.equal(result.geometry.attributes.color.count, 48);
    for (let index = 0; index < 48; index++) assert.equal(result.geometry.attributes.color.getW(index), 1);
    trace.dispose(); result.geometry.dispose(); geometry.dispose(); uncoloredGeometry.dispose(); material.dispose(); plain.dispose();
  }
});
