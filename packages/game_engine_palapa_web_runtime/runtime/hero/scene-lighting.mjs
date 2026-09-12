import { DirectionalLight, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, Vector3 } from './vendor/three.module.min.js';

export const DAYLIGHT = Object.freeze({
  skyTop: 0xedf4ff, skyBottom: 0xd6cec0, environmentIntensity: 0.85,
  sunColor: 0xfff6e8, sunIntensity: 0.8,
});

const SUN_OFFSETS = Object.freeze([[0, 0], [-230, 170], [230, -170]]);

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

export function createSunlight(scene, { mapSize = 2048 } = {}) {
  const target = new Object3D();
  const lights = SUN_OFFSETS.map((_, index) => {
    const light = new DirectionalLight(DAYLIGHT.sunColor, DAYLIGHT.sunIntensity / SUN_OFFSETS.length);
    light.name = index ? `Sunlight fill ${index}` : 'Sunlight';
    light.target = target;
    light.castShadow = true;
    const shadowMapSize = Math.min(1024, mapSize);
    light.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    light.shadow.radius = 4;
    light.shadow.normalBias = 0.6;
    light.shadow.bias = -0.00002;
    return light;
  });
  const light = lights[0];
  scene.add(...lights, target);
  const corner = new Vector3();
  return {
    light, lights,
    resize(width, height) {
      target.position.set(0, -height / 2, -500);
      const scale = Math.max(1, (Math.hypot(width, height) + 2000) / 2500);
      lights.forEach((source, index) => {
        const [offsetX, offsetY] = SUN_OFFSETS[index];
        source.position.copy(target.position).add(new Vector3(-500 + offsetX, 750 + offsetY, 4000).multiplyScalar(scale));
        scene.updateMatrixWorld(true);
        source.shadow.updateMatrices(source);
        const camera = source.shadow.camera;
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
      });
    },
    dispose() { scene.remove(...lights, target); lights.forEach(source => source.dispose()); },
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
