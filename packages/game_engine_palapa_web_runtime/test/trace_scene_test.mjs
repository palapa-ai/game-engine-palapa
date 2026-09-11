import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../runtime/hero/vendor/three.module.min.js';
import { cloneTraceScene, traceForeground, traceRoles, traceStageFor } from '../runtime/hero/trace-scene.mjs';
import { BackdropCache } from '../runtime/hero/backdrop-cache.mjs';
import { ProgressiveResolution } from '../runtime/hero/progressive-resolution.mjs';
import { traceConfidence, traceDisplayLimit } from '../runtime/hero/trace-confidence.mjs';

function fixture() {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const mesh = (name, role) => {
    const value = new THREE.Mesh(geometry, material);
    value.name = name;
    if (role) value.userData.traceRole = role;
    return value;
  };
  const wall = mesh('wall', 'backdrop'), palm = mesh('palm', 'content');
  const words = new THREE.Group(); words.name = 'words'; words.userData.traceRole = 'text';
  words.position.set(4, 5, 6); words.scale.setScalar(2);
  const text = mesh('text'), divider = mesh('divider', 'content');
  words.add(text, divider);
  const nested = mesh('nested-text', 'text'); nested.position.set(2, 3, 4);
  wall.position.set(10, 20, 30); wall.add(nested);
  const moving = new THREE.Group(); moving.userData.dynamic = true;
  moving.add(mesh('moving-text', 'text'));
  const hidden = mesh('hidden-text', 'text'); hidden.visible = false;
  scene.add(wall, palm, words, moving, hidden);
  scene.updateMatrixWorld(true);
  return { scene, wall, palm, words, text, divider, nested, geometry, material };
}

const meshes = scene => {
  const result = [];
  scene.traverse(object => { if (object.isMesh) result.push(object); });
  return result;
};

test('text mode excludes non-text geometry from the BVH clone while retaining inherited transforms', () => {
  const f = fixture(), selected = cloneTraceScene(f.scene, 'text');
  assert.ok(traceRoles.includes('text'));
  assert.equal(selected.meshes, 2);
  assert.deepEqual(meshes(selected.scene).map(mesh => mesh.name).sort(), ['nested-text', 'text']);
  selected.scene.updateMatrixWorld(true);
  for (const source of [f.text, f.nested]) {
    const clone = selected.scene.getObjectByName(source.name);
    assert.deepEqual(clone.matrixWorld.elements, source.matrixWorld.elements);
    assert.equal(clone.geometry, f.geometry);
    assert.equal(clone.material, f.material);
  }
  assert.equal(selected.scene.getObjectByName('wall').isMesh, undefined, 'a mesh ancestor becomes a transform-only group');
  assert.equal(f.wall.isMesh, true);
  assert.equal(f.nested.parent, f.wall, 'filtering never mutates the raster scene');
});

test('full-scene selection preserves static artwork and text while dynamic and hidden geometry stay excluded', () => {
  const f = fixture(), selected = cloneTraceScene(f.scene, 'scene');
  assert.deepEqual(meshes(selected.scene).map(mesh => mesh.name).sort(), ['divider', 'nested-text', 'palm', 'text', 'wall']);
  assert.equal(selected.meshes, 5);
  const empty = cloneTraceScene(new THREE.Scene(), 'text');
  assert.equal(empty.meshes, 0, 'an empty text scene can finish without building an empty BVH');
});

test('text-only cache removes text but retains the raster wall and artwork', () => {
  const f = fixture(), cache = new BackdropCache();
  const before = {};
  const renderer = {
    target: before, autoClear: false,
    getRenderTarget() { return this.target; },
    setRenderTarget(value) { this.target = value; },
    render() {
      assert.equal(f.text.visible, false);
      assert.equal(f.nested.visible, false);
      assert.equal(f.wall.visible, true);
      assert.equal(f.palm.visible, true);
      assert.equal(f.divider.visible, true);
    },
  };
  assert.equal(traceForeground('text', 'text'), true);
  assert.equal(traceForeground('content', 'text'), false);
  assert.equal(traceForeground('backdrop', 'text'), false);
  assert.equal(traceForeground('content', 'scene'), true);
  cache.refresh(renderer, f.scene, new THREE.Camera(), [f.text, f.nested]);
  assert.equal(f.text.visible, true);
  assert.equal(f.nested.visible, true);
  assert.equal(renderer.target, before);
  assert.equal(renderer.autoClear, false);
  cache.dispose();
});

test('text mode has no wall stage and refines past four samples to the selected quality', () => {
  assert.equal(traceStageFor('text', true), 'text');
  assert.equal(traceStageFor('text', false), 'text');
  assert.equal(traceStageFor('scene', true), 'foreground');
  assert.equal(traceStageFor('scene', false), 'background');
  const resolution = new ProgressiveResolution();
  assert.equal(resolution.complete({ samples: 4, scale: 1, targetSamples: 64 }), false);
  assert.equal(resolution.complete({ samples: 64, scale: 0.5, targetSamples: 64 }), false);
  assert.deepEqual(resolution.advance({ samples: 4, scale: 0.5, tiles: 4, now: 1000, targetSamples: 64 }), { scale: 1, tiles: 8 });
  assert.equal(resolution.sampleTarget(1, 64), 64);
  assert.equal(resolution.complete({ samples: 64, scale: 1, targetSamples: 64 }), true);
});

test('coarse or unfinished text never replaces the readable raster at full opacity', () => {
  const viewport = { width: 1024, height: 768 };
  for (const scale of [0.125, 0.25, 0.5, 1]) {
    const target = { width: viewport.width * scale, height: viewport.height * scale };
    assert.equal(traceDisplayLimit(target, viewport, false), 0, 'unfinished bounce quality retains the raster');
    const limit = traceDisplayLimit(target, viewport, true);
    assert.equal(traceConfidence(1000000, 64, limit), scale ** 2);
    if (scale < 1) assert.ok(limit < 1);
  }
});

test('multi-material meshes retain every face material without shifting later textures or colors', async () => {
  const { PathTracingSceneGenerator } = await import('../runtime/hero/vendor/three-gpu-pathtracer.module.js');
  const scene = new THREE.Scene();
  const materials = [0xff0000, 0x00ff00, 0x0000ff].map(color => new THREE.MeshStandardMaterial({ color }));
  materials[2].map = new THREE.Texture();
  const striped = new THREE.Mesh(new THREE.PlaneGeometry(), materials.slice(0, 2));
  striped.geometry.clearGroups();
  striped.geometry.addGroup(0, 3, 0);
  striped.geometry.addGroup(3, 3, 1);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(), materials[2]);
  flag.position.x = 3;
  scene.add(striped, flag);
  for (let rebuild = 0; rebuild < 3; rebuild++) {
    const trace = cloneTraceScene(scene, 'scene');
    trace.scene.updateMatrixWorld(true);
    const generator = new PathTracingSceneGenerator(trace.scene);
    const result = generator.generate();
    const { geometry, materials: assigned } = result;
    const p = geometry.attributes.position, ids = geometry.attributes.materialIndex;
    for (let index = 0; index < geometry.index.count; index += 3) {
      const corners = [0, 1, 2].map(corner => geometry.index.getX(index + corner));
      const x = corners.reduce((sum, corner) => sum + p.getX(corner), 0) / 3;
      const y = corners.reduce((sum, corner) => sum + p.getY(corner), 0) / 3;
      const expected = x > 2 ? materials[2] : y > 0 ? materials[0] : materials[1];
      corners.forEach(corner => assert.equal(assigned[ids.getX(corner)], expected));
    }
    assert.equal(assigned.find(material => material === materials[2]).map, materials[2].map);
    assert.equal(trace.meshes, 3);
    assert.equal(striped.geometry.groups.length, 2);
    trace.dispose();
    geometry.dispose();
  }
});
