import * as THREE from '../hero/vendor/three.module.min.js';
import { loadSceneAsset, disposeSceneAsset } from '../assets/scene-asset.mjs';

const hashCell = (column, row, seed) => {
  let value = (Math.imul(column, 374761393) + Math.imul(row, 668265263) + seed) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
};

export async function createBrickWall(host, assetUrl) {
  const asset = await loadSceneAsset(assetUrl);
  const layout = asset.userData.assetMetadata.brickLayout;
  if (!layout || !(layout.aspect > 0) || !(layout.courseFraction > 0)) {
    disposeSceneAsset(asset);
    throw new Error('Brick asset is missing its layout');
  }
  const variants = [];
  const palette = [];
  asset.traverse(object => {
    if (!object.isMesh) return;
    if (/^Variant_\d+$/.test(object.name)) variants.push(object);
    for (const material of [].concat(object.material)) {
      const match = /^Clay_(\d+)$/.exec(material.name);
      if (match) palette[Number(match[1])] = material;
    }
  });
  variants.sort((a, b) => Number(a.name.split('_')[1]) - Number(b.name.split('_')[1]));
  const mortar = asset.getObjectByName('Mortar');
  if (!variants.length || !palette.length || !mortar?.isMesh) {
    disposeSceneAsset(asset);
    throw new Error('Brick asset is incomplete');
  }
  const group = new THREE.Group();
  group.name = 'BrickWall';
  group.position.z = -500;
  let width = 0, height = 0, disposed = false;
  host.add(group);
  return {
    group,
    resize(cssWidth, cssHeight) {
      if (disposed || cssWidth <= 0 || cssHeight <= 0 || (width === cssWidth && height === cssHeight)) return;
      width = cssWidth; height = cssHeight;
      group.clear();
      const bed = new THREE.Mesh(mortar.geometry, mortar.material);
      bed.scale.set(width, height, 1);
      bed.position.set(0, -height / 2, 0);
      group.add(bed);
      const course = Math.max(layout.minimumWidth, width) * layout.courseFraction;
      const brickWidth = course * layout.aspect;
      for (let row = -1; row >= -Math.ceil(height / course); row--) {
        const shift = ((row % 2 + 2) % 2) * brickWidth / 2;
        for (let column = Math.floor(-shift / brickWidth); column <= Math.floor((width - shift) / brickWidth); column++) {
          const hash = hashCell(column, row, layout.seed);
          if (hash % 1000 < layout.missingPerThousand) continue;
          const variant = variants[hash % variants.length];
          const material = palette[(hash >>> 8) % palette.length];
          const mesh = new THREE.Mesh(variant.geometry, material);
          mesh.name = `Brick_${column}_${row}`;
          mesh.scale.setScalar(course);
          mesh.position.set((column + .5) * brickWidth + shift - width / 2, (row + .5) * course, 0);
          group.add(mesh);
        }
      }
      host.invalidate({ geometry: true });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      host.remove(group);
      group.clear();
      disposeSceneAsset(asset);
    },
  };
}
