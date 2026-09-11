import { Group } from './vendor/three.module.min.js';

export const traceRoles = Object.freeze(['content', 'backdrop', 'text']);

export function traceStageFor(mode, hasBackdrop = false) {
  return mode === 'text' ? 'text' : hasBackdrop ? 'foreground' : 'background';
}

export function traceForeground(role, mode) {
  return mode === 'text' ? role === 'text' : role !== 'backdrop';
}

// Keep parent transforms without retaining unselected parent mesh geometry.
export function cloneTraceScene(scene, mode) {
  let meshes = 0;
  const visit = (object, inherited = 'content') => {
    if (!object.visible || object.userData.dynamic === true) return null;
    const role = object.userData.traceRole ?? inherited;
    const selected = !object.isMesh || mode === 'scene' || role === 'text';
    const children = object.children.map(child => visit(child, role)).filter(Boolean);
    if (!selected && children.length === 0) return null;
    const result = selected ? object.clone(false) : new Group().copy(object, false);
    if (result.isMesh) meshes++;
    children.forEach(child => result.add(child));
    return result;
  };
  return { scene: visit(scene), meshes };
}
