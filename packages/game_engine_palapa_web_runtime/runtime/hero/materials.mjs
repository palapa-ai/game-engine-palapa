import * as THREE from './vendor/three.module.min.js';

export function rubber(color) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 });
  material.userData.noReflect = true;
  return material;
}
