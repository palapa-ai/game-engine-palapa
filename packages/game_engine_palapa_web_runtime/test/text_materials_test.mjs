import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../runtime/hero/vendor/three.module.min.js';
import { disposeMaterials, textMaterials } from '../runtime/hero/materials.mjs';

test('preserved color emits from text caps while retaining physically shaded sides', () => {
  const source = new THREE.MeshStandardMaterial({ color: 0x73c991 });
  const result = textMaterials(source, { preserveColor: true });
  assert.equal(result.length, 2);
  assert.equal(result[0].color.getHex(), 0x000000);
  assert.equal(result[0].emissive.getHex(), 0x73c991);
  assert.equal(result[0].toneMapped, false);
  assert.equal(result[1], source);
  disposeMaterials(result);
});

test('preserved white stays bright without changing colored text', () => {
  const white = textMaterials(new THREE.MeshStandardMaterial({ color: 0xffffff }), { preserveWhite: true });
  const pink = textMaterials(new THREE.MeshStandardMaterial({ color: 0xcc77ff }), { preserveWhite: true });
  assert.equal(white.emissive.getHex(), 0xffffff);
  assert.equal(white.toneMapped, false);
  assert.equal(pink.emissive.getHex(), 0x000000);
  disposeMaterials(white); disposeMaterials(pink);
});
