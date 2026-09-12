import * as THREE from './vendor/three.module.min.js';

// Refreshed with the static scene, never during steady-state presentation.
export class BackdropCache {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.disposed = false;
  }
  resize(width, height) { this.target.setSize(width, height); }
  refresh(renderer, scene, camera, foregroundMeshes) {
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const visible = foregroundMeshes.map(mesh => mesh.visible);
    foregroundMeshes.forEach(mesh => { mesh.visible = false; });
    try {
      renderer.setRenderTarget(this.target);
      renderer.autoClear = true;
      renderer.render(scene, camera);
    } finally {
      foregroundMeshes.forEach((mesh, index) => { mesh.visible = visible[index]; });
      renderer.setRenderTarget(previousTarget);
      renderer.autoClear = previousAutoClear;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.target.dispose();
  }
}
