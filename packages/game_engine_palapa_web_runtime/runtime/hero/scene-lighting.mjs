import { DirectionalLight, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from './vendor/three.module.min.js';

// A spinning sphere keeps the same light silhouette. Its camera-visible skin
// can animate independently while this stationary surface occludes light.
export function createSphereOccluder(radius) {
  const material = new MeshStandardMaterial({ color: 0x777777, roughness: 1, colorWrite: false, depthWrite: false });
  material.matte = true;
  const mesh = new Mesh(new SphereGeometry(radius, 48, 32), material);
  mesh.name = 'sphere-shadow-occluder';
  mesh.castShadow = true;
  return mesh;
}

export function createMoonlight(scene, { mapSize = 2048 } = {}) {
  const light = new DirectionalLight(0xdbeaff, 1.6);
  light.name = 'Moonlight';
  light.castShadow = true;
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.normalBias = 0.6;
  light.shadow.bias = -0.00002;
  scene.add(light, light.target);
  const corner = new Vector3();
  return {
    light,
    resize(width, height) {
      light.target.position.set(0, -height / 2, -500);
      light.position.copy(light.target.position).add(new Vector3(-900, 1100, 2100)
        .multiplyScalar(Math.max(1, (Math.hypot(width, height) + 2000) / 2500)));
      scene.updateMatrixWorld(true);
      light.shadow.updateMatrices(light);
      const camera = light.shadow.camera;
      let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
      let near = Infinity, far = -Infinity;
      for (const x of [-width / 2, width / 2]) {
        for (const y of [-height, 0]) {
          for (const z of [-550, 400]) {
            corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
            left = Math.min(left, corner.x); right = Math.max(right, corner.x);
            bottom = Math.min(bottom, corner.y); top = Math.max(top, corner.y);
            near = Math.min(near, -corner.z); far = Math.max(far, -corner.z);
          }
        }
      }
      Object.assign(camera, { left: left - 40, right: right + 40,
        bottom: bottom - 40, top: top + 40, near: Math.max(0.1, near - 40), far: far + 40 });
      camera.updateProjectionMatrix();
    },
    dispose() { scene.remove(light, light.target); light.dispose(); },
  };
}

export function enableSceneShadows(scene) {
  scene.traverse(object => {
    if (object.userData.shadows === false) return;
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    } else if (object.isPointLight) {
      object.castShadow = true;
      object.shadow.mapSize.set(1024, 1024);
      object.shadow.camera.near = 1;
      object.shadow.camera.far = 10000;
      object.shadow.normalBias = 0.6;
    }
  });
}
