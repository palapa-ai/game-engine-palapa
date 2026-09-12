import { BufferGeometry, Group, Mesh } from './vendor/three.module.min.js';

export const traceRoles = Object.freeze(['content', 'backdrop', 'text']);

export function traceStageFor(mode, hasBackdrop = false, content = true) {
  return mode === 'text' ? 'text' : hasBackdrop && content ? 'foreground' : 'background';
}

export function traceForeground(role, mode) {
  return mode === 'text' ? role === 'text' : role !== 'backdrop';
}

// Keep parent transforms without retaining unselected parent mesh geometry.
export function cloneTraceScene(scene, mode) {
  let meshes = 0;
  const geometries = [];
  const visit = (object, inherited = 'content') => {
    if (!object.visible || object.userData.dynamic === true) return null;
    const role = object.userData.traceRole ?? inherited;
    const selected = !object.isMesh || mode === 'scene' || role === 'text';
    const children = object.children.map(child => visit(child, role)).filter(Boolean);
    if (!selected && children.length === 0) return null;
    const split = selected && object.isMesh && Array.isArray(object.material);
    const result = selected && !split ? object.clone(false) : new Group().copy(object, false);
    // The tracing generator creates one material group per mesh. Split arrays
    // here so its mesh order and material order agree, including shared vertices
    // on the boundary between two materials. Leave the raster geometry intact.
    if (split) {
      const source = object.geometry;
      const count = source.index?.count ?? source.attributes.position.count;
      const indices = new Map();
      for (const group of source.groups) {
        const material = object.material[group.materialIndex];
        if (!material) continue;
        const start = Math.max(group.start, source.drawRange.start);
        const end = Math.min(count, group.start + group.count, source.drawRange.start + source.drawRange.count);
        const values = indices.get(material) ?? [];
        for (let index = start; index < end; index++) values.push(source.index ? source.index.getX(index) : index);
        indices.set(material, values);
      }
      for (const [material, indicesForMaterial] of indices) {
        if (!indicesForMaterial.length) continue;
        const geometry = new BufferGeometry();
        for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
        geometry.setIndex(indicesForMaterial);
        geometries.push(geometry);
        result.add(new Mesh(geometry, material));
        meshes++;
      }
    }
    if (result.isMesh) meshes++;
    children.forEach(child => result.add(child));
    return result;
  };
  return { scene: visit(scene), meshes, dispose() { geometries.forEach(geometry => geometry.dispose()); } };
}
