import * as THREE from '../hero/vendor/three.module.min.js';
import { traceStaticLighting } from '../hero/static-lighting.mjs';

export function lightMovingGroup(canvas, group, camera, height, render) {
  const snapshot = new THREE.Scene();
  snapshot.add(new THREE.AmbientLight(0xffffff, 0.75));
  const light = new THREE.DirectionalLight(0xfff6e5, 2.3);
  light.position.set(-3, 3, 5);
  snapshot.add(light);
  group.updateWorldMatrix(true, true);
  const pairs = [];
  group.traverse(live => {
    if (!live.isMesh || live.isLineSegments2 || !live.material?.color) return;
    const copy = new THREE.Mesh(live.geometry.clone(), live.material.clone());
    copy.matrix.copy(live.matrixWorld);
    copy.matrixAutoUpdate = false;
    snapshot.add(copy);
    pairs.push({ live, copy, lit: false });
  });
  let disposed = false;
  const lighting = traceStaticLighting(canvas, snapshot, camera.clone(), height, group.uuid, () => {
    if (disposed) return;
    for (const pair of pairs) {
      const colors = pair.copy.geometry.getAttribute('color');
      if (!colors) continue;
      pair.live.geometry.setAttribute('color', colors.clone());
      if (!pair.lit) {
        const original = pair.live.material;
        pair.live.material = new THREE.MeshBasicMaterial({
          color: 0xffffff, vertexColors: true, map: original.map,
          transparent: original.transparent, opacity: original.opacity,
          alphaTest: original.alphaTest, side: original.side,
          clippingPlanes: original.clippingPlanes,
        });
        pair.lit = true;
      }
    }
    render();
  });
  return {
    dispose() {
      disposed = true;
      lighting.dispose();
      pairs.forEach(({copy}) => { copy.geometry.dispose(); copy.material.dispose(); });
    },
  };
}
