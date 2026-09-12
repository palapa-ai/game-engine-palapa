export function normalizeTraceViewport(value) {
  if (value == null) return null;
  const { left, top, width, height, fullWidth, fullHeight } = value;
  if (![left, top, width, height, fullWidth, fullHeight].every(Number.isFinite)
      || width <= 0 || height <= 0 || fullWidth <= 0 || fullHeight <= 0) {
    throw new RangeError('Trace viewport must have finite coordinates and positive dimensions');
  }
  const canvasWidth = Math.floor(fullWidth), canvasHeight = Math.floor(fullHeight);
  const x = Math.max(0, Math.floor(left)), y = Math.max(0, Math.floor(top));
  const right = Math.min(canvasWidth, Math.ceil(left + width));
  const bottom = Math.min(canvasHeight, Math.ceil(top + height));
  if (right <= x || bottom <= y) throw new RangeError('Trace viewport must overlap the drawing buffer');
  return { left: x, top: y, width: right - x, height: bottom - y, fullWidth: canvasWidth, fullHeight: canvasHeight };
}

export function sameTraceViewport(a, b) {
  return a === b || !!a && !!b && ['left', 'top', 'width', 'height', 'fullWidth', 'fullHeight']
    .every(key => a[key] === b[key]);
}

export function traceViewportSize(viewport, scale, maxTextureSize = Infinity) {
  const factor = Math.min(scale, maxTextureSize / Math.max(viewport.width, viewport.height));
  return {
    width: Math.max(1, Math.floor(viewport.width * factor)),
    height: Math.max(1, Math.floor(viewport.height * factor)),
  };
}

export function applyTraceViewport(camera, source, viewport) {
  camera.copy(source);
  if (viewport) {
    if (!camera.isOrthographicCamera) throw new TypeError('Trace viewports require an orthographic camera');
    camera.setViewOffset(viewport.fullWidth, viewport.fullHeight,
      viewport.left, viewport.top, viewport.width, viewport.height);
  }
  camera.updateMatrixWorld();
}
