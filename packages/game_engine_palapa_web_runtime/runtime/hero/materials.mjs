import * as THREE from './vendor/three.module.min.js';

export function textMaterials(material, { preserveColor = false, preserveWhite = false } = {}) {
  if (preserveColor) {
    const face = material.clone();
    face.emissive.copy(material.color);
    face.color.set(0x000000);
    face.toneMapped = false;
    // TextGeometry assigns caps to material 0 and extruded sides to material 1.
    return [face, material];
  }
  if (preserveWhite && material.color.getHex() === 0xffffff) {
    material.emissive.set(0xffffff);
    material.toneMapped = false;
  }
  return material;
}

export function disposeMaterials(material) {
  [material].flat().forEach(value => value?.dispose());
}

export function rubber(color) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 });
  material.userData.noReflect = true;
  return material;
}
