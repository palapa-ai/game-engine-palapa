import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlanetMaterials, planetNames, planetPixels } from '../runtime/capacity/planet-materials.mjs';

test('globe cycle begins with monochrome Earth and contains every planet plus the Moon', () => {
  assert.deepEqual(planetNames, [
    'black and white Earth', 'Mercury', 'Venus', 'realistic Earth', 'historical Earth',
    'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Moon',
  ]);
});

test('procedural planet textures are deterministic, opaque, and visually varied', () => {
  for (const name of planetNames.filter(value => !value.includes('Earth'))) {
    const first = planetPixels(name, 32, 16), second = planetPixels(name, 32, 16);
    assert.deepEqual(first, second);
    assert.equal(first.length, 32 * 16 * 4);
    assert.ok(new Set(first.filter((_, index) => index % 4 !== 3)).size > 8, `${name} needs visible surface detail`);
    for (let index = 3; index < first.length; index += 4) assert.equal(first[index], 255);
  }
});

test('planet material resources can be disposed together', () => {
  const result = createPlanetMaterials();
  assert.deepEqual([...result.materials.keys()], ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Moon']);
  assert.equal(result.textures.size, result.materials.size);
  result.materials.forEach(material => material.dispose());
  result.textures.forEach(texture => texture.dispose());
});
