import * as THREE from '../hero/vendor/three.module.min.js';

export async function loadSceneAsset(url, { signal } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Scene asset unavailable: ${response.status}`);
  const asset = await response.json();
  if (asset.version !== 1 || !Array.isArray(asset.nodes) || !Array.isArray(asset.materials)) {
    throw new Error('Unsupported compiled scene');
  }
  const binaryResponse = await fetch(new URL(asset.buffer, response.url || url), { signal });
  if (!binaryResponse.ok) throw new Error(`Scene geometry unavailable: ${binaryResponse.status}`);
  const binary = await binaryResponse.arrayBuffer();
  const materials = asset.materials.map(value => new THREE.MeshStandardMaterial({
    name: value.name, color: new THREE.Color(...value.color),
    roughness: value.roughness, metalness: value.metalness,
    emissive: new THREE.Color(...(value.emissive || [0, 0, 0])),
    opacity: value.opacity, transparent: value.opacity < 1,
  }));
  const sideMaterials = new Map();
  const material = (index, doubleSided) => {
    if (!doubleSided) return materials[index];
    if (!sideMaterials.has(index)) {
      const copy = materials[index].clone();
      copy.side = THREE.DoubleSide;
      sideMaterials.set(index, copy);
    }
    return sideMaterials.get(index);
  };
  const attribute = (value, type, size) => {
    if (!Number.isInteger(value.offset) || !Number.isInteger(value.count) || value.count < 0 ||
        value.offset < 0 || value.offset % 4 || value.offset + value.count * size * 4 > binary.byteLength) {
      throw new Error('Invalid scene geometry buffer');
    }
    return new THREE.BufferAttribute(new type(binary, value.offset, value.count * size), size);
  };
  const build = value => {
    let object;
    if (value.geometry) {
      const source = value.geometry;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', attribute(source.position, Float32Array, 3));
      geometry.setIndex(attribute(source.index, Uint32Array, 1));
      if (source.normal) geometry.setAttribute('normal', attribute(source.normal, Float32Array, 3));
      else geometry.computeVertexNormals();
      if (source.uv) geometry.setAttribute('uv', attribute(source.uv, Float32Array, 2));
      const bound = [...new Set(source.groups.map(group => group.material))];
      for (const group of source.groups) geometry.addGroup(group.start, group.count, bound.indexOf(group.material));
      const mapped = bound.map(index => material(index, source.doubleSided));
      object = new THREE.Mesh(geometry, mapped.length === 1 ? mapped[0] : mapped);
    } else object = new THREE.Group();
    object.name = value.name;
    if (value.matrix) new THREE.Matrix4().fromArray(value.matrix).decompose(object.position, object.quaternion, object.scale);
    object.visible = value.visible !== false;
    object.userData = value.metadata || {};
    for (const child of value.children || []) object.add(build(child));
    return object;
  };
  const root = new THREE.Group();
  root.name = 'SceneAsset';
  root.userData.assetMetadata = asset.metadata || {};
  for (const node of asset.nodes) root.add(build(node));
  return root;
}

export function disposeSceneAsset(root) {
  const geometries = new Set(), materials = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const value of object.material ? [].concat(object.material) : []) materials.add(value);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}
