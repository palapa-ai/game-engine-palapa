import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../runtime/hero/vendor/three.module.min.js';
import { createMoonlight, createSphereOccluder, enableSceneShadows } from '../runtime/hero/scene-lighting.mjs';
import { cloneTraceScene, traceStageFor } from '../runtime/hero/trace-scene.mjs';

test('moon shadow projection encloses desktop and tall mobile page geometry', () => {
  const scene = new THREE.Scene();
  const moon = createMoonlight(scene);
  for (const [width, height] of [[1440, 3600], [390, 8200]]) {
    moon.resize(width, height);
    const camera = moon.light.shadow.camera;
    for (const x of [-width / 2, width / 2]) {
      for (const y of [-height, 0]) {
        for (const z of [-550, 400]) {
          const projected = new THREE.Vector3(x, y, z).project(camera);
          assert.ok(Math.max(Math.abs(projected.x), Math.abs(projected.y), Math.abs(projected.z)) <= 1);
        }
      }
    }
  }
  moon.dispose();
  assert.equal(scene.children.length, 0);
});

test('wall, lettering, orb and moon share trace geometry and shadow casters', () => {
  const scene = new THREE.Scene();
  const moon = createMoonlight(scene);
  const material = new THREE.MeshStandardMaterial();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 5), material);
  wall.name = 'wall'; wall.userData.traceRole = 'backdrop'; wall.position.z = -500;
  const letters = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 5), material);
  letters.name = 'letters'; letters.userData.traceRole = 'text';
  const orb = new THREE.PointLight(0xddeeff, 120000); orb.name = 'orb'; orb.position.z = 100;
  scene.add(wall, letters, orb);
  enableSceneShadows(scene);
  moon.resize(100, 100);
  const trace = cloneTraceScene(scene, 'scene');
  assert.equal(trace.meshes, 2);
  for (const name of ['wall', 'letters', 'orb', 'Moonlight']) {
    assert.ok(trace.scene.getObjectByName(name));
    assert.equal(scene.getObjectByName(name).castShadow, true);
  }
  assert.equal(wall.receiveShadow, true);
  assert.equal(trace.scene.getObjectByName('orb').intensity, 120000);
  assert.equal(traceStageFor('scene', true, false), 'background', 'bricks can trace while content display stays raster');
  assert.equal(traceStageFor('scene', true, true), 'foreground');
  trace.dispose(); moon.dispose(); wall.geometry.dispose(); letters.geometry.dispose(); material.dispose();
});

test('spinning globe occlusion stays in the static world without covering its animated skin', () => {
  const scene = new THREE.Scene();
  const globe = new THREE.Group(); globe.userData.dynamic = true;
  const occluder = createSphereOccluder(0.99);
  occluder.position.set(2, -3, 4); occluder.scale.setScalar(120);
  scene.add(globe, occluder);
  const trace = cloneTraceScene(scene, 'scene');
  assert.equal(trace.meshes, 1);
  const surface = trace.scene.getObjectByName(occluder.name);
  assert.equal(surface.material.matte, true, 'primary camera rays do not show the static surrogate');
  assert.equal(occluder.material.colorWrite, false);
  assert.equal(occluder.material.depthWrite, false);
  assert.equal(surface.castShadow, true);
  assert.deepEqual(surface.position.toArray(), [2, -3, 4]);
  assert.equal(surface.geometry.parameters.radius * surface.scale.x, 118.8);
  trace.dispose(); occluder.geometry.dispose(); occluder.material.dispose();
});
