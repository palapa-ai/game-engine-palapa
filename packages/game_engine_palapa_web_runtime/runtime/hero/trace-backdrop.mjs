// A matte material is skipped only for primary camera hits by the path tracer.
// The same geometry and material still participate in secondary rays.
export function prepareTraceBackdrop(scene, foregroundOnly = false) {
  const materials = new Map();
  const bindings = [];
  let foreground = !!foregroundOnly;
  let disposed = false;
  const clone = original => {
    if (!materials.has(original)) {
      const value = original.clone();
      value.matte = foreground || original.matte === true;
      materials.set(original, value);
    }
    return materials.get(original);
  };
  const visit = (object, inherited = 'content') => {
    const role = object.userData.traceRole ?? inherited;
    if (object.isMesh && role === 'backdrop') {
      const original = object.material;
      const replacement = Array.isArray(original) ? original.map(clone) : clone(original);
      bindings.push({ object, original, replacement });
      object.material = replacement;
    }
    object.children.forEach(child => visit(child, role));
  };
  visit(scene);
  return {
    get hasBackdrop() { return materials.size > 0; },
    get foregroundOnly() { return foreground; },
    setForegroundOnly(value) {
      if (disposed || foreground === !!value) return false;
      foreground = !!value;
      materials.forEach((material, original) => { material.matte = foreground || original.matte === true; });
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      bindings.forEach(({ object, original, replacement }) => {
        if (object.material === replacement) object.material = original;
      });
      materials.forEach(material => material.dispose());
      materials.clear();
    },
  };
}
