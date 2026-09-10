import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSceneAsset, disposeSceneAsset } from '../runtime/assets/scene-asset.mjs';

test('compiled glass transmits through a physical volume while presence and cutouts retain alpha behavior', async t => {
  const binary = new ArrayBuffer(48);
  new Float32Array(binary, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Uint32Array(binary, 36, 3).set([0, 1, 2]);
  const defaults = { color: [1, 1, 1], roughness: .2, metalness: 0 };
  const asset = {
    version: 1, buffer: 'sample.bin', materials: [
      { ...defaults, name: 'Glass', opacity: 1, transmission: .8, ior: 1.52, clearcoat: .25 },
      { ...defaults, name: 'Presence', opacity: .2 },
      { ...defaults, name: 'Cutout', opacity: .2, alphaTest: .3 },
    ],
    nodes: ['Glass', 'Presence', 'Cutout'].map((name, index) => ({
      name, geometry: {
        position: { offset: 0, count: 3 }, index: { offset: 36, count: 3 },
        groups: [{ start: 0, count: 3, material: index }], doubleSided: false,
      },
    })),
  };
  const fetch = globalThis.fetch;
  globalThis.fetch = async url => new Response(String(url).endsWith('.bin') ? binary : JSON.stringify(asset));
  t.after(() => { globalThis.fetch = fetch; });
  const root = await loadSceneAsset('https://example.test/sample.json');
  t.after(() => disposeSceneAsset(root));
  const glass = root.getObjectByName('Glass').material;
  assert.equal(glass.isMeshPhysicalMaterial, true);
  assert.equal(glass.transmission, .8);
  assert.equal(glass.ior, 1.52);
  assert.equal(glass.opacity, 1);
  assert.equal(glass.transparent, false);
  assert.ok(glass.thickness > 0, 'closed authored glass must refract through both surfaces');
  assert.equal(glass.clearcoat, .25);
  const presence = root.getObjectByName('Presence').material;
  assert.equal(presence.opacity, .2);
  assert.equal(presence.transparent, true);
  const cutout = root.getObjectByName('Cutout').material;
  assert.equal(cutout.alphaTest, .3);
  assert.equal(cutout.transparent, false);
});
