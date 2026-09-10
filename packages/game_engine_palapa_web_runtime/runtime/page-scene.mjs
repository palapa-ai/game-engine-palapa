import * as THREE from './hero/vendor/three.module.min.js';
import { attachTracer } from './hero/tracer.mjs';
import { renderSettings } from './hero/render-settings.mjs';

const MAX_PIXELS = 3000000;
const AUTO_SAMPLES = 64;

export function createPageScene(canvas, options = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 0, -1, 0.1, 10000);
  camera.position.z = 2000;
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  [[0.9, -800, 1200, 1800], [0.35, 1000, -300, 1400]].forEach(([power, x, y, z]) => {
    const light = new THREE.DirectionalLight(0xffffff, power);
    light.position.set(x, y, z);
    scene.add(light, light.target);
  });

  const callbacks = new Set();
  let width = 0, height = 0, ratio = 1;
  let frame = 0, previous = null, tracer = null;
  let disposed = false, building = false, geometryDirty = true, dirty = true;
  let revision = 0, phase = 'starting', firstFrame = false;
  let dynamicRoots = [], staticMeshes = [];
  let traceEnabled = true, contextAvailable = true;

  const notify = (callback, value) => {
    try { callback?.(value); } catch (error) { console.error(error); }
  };
  const collect = () => {
    dynamicRoots = [];
    staticMeshes = [];
    const visit = (object, dynamic) => {
      const moving = dynamic || object.userData.dynamic === true;
      if (moving && !dynamic) dynamicRoots.push(object);
      if (object.isMesh && !moving) staticMeshes.push(object);
      object.children.forEach(child => visit(child, moving));
    };
    visit(scene, false);
  };
  const hidden = objects => {
    const visibility = objects.map(object => object.visible);
    objects.forEach(object => { object.visible = false; });
    return () => objects.forEach((object, index) => { object.visible = visibility[index]; });
  };
  const status = () => {
    canvas.dataset.render = phase;
    canvas.dataset.traceMethod = 'path-tracing';
    canvas.dataset.traceRevision = String(revision);
    canvas.dataset.traceSamples = String(tracer?.samples || 0);
    canvas.dataset.traceTargetSamples = String(renderSettings.value.samples ?? AUTO_SAMPLES);
    canvas.dataset.traceBounces = String(renderSettings.value.bounces);
    canvas.dataset.sceneCount = '1';
  };
  const wake = () => {
    if (!frame && !disposed && contextAvailable && !document.hidden && width && height) frame = requestAnimationFrame(draw);
  };
  const fail = error => {
    traceEnabled = false;
    geometryDirty = false;
    tracer?.dispose(); tracer = null;
    phase = 'fallback';
    canvas.dataset.traceFailure = String(error?.message || error);
    status();
    notify(options.onError, error);
    dirty = true;
  };
  const rebuild = async () => {
    if (building || disposed || !traceEnabled) return;
    building = true;
    geometryDirty = false;
    const version = revision;
    tracer?.dispose(); tracer = null;
    collect();
    const restore = hidden(dynamicRoots);
    phase = 'loading';
    canvas.dataset.traceStartedAt = String(performance.now());
    delete canvas.dataset.traceFinishedAt;
    status();
    try {
      const quality = renderSettings.value;
      const next = await attachTracer(renderer, scene, camera, {
        bounces: quality.bounces, rtRes: 1, fxRes: 1, tiles: 4,
      });
      if (disposed || version !== revision) next.dispose();
      else {
        tracer = next;
        phase = 'tracing';
      }
    } catch (error) {
      if (!disposed && version === revision) fail(error);
    } finally {
      restore();
      building = false;
      dirty = true;
      status();
      wake();
    }
  };
  const raster = () => {
    renderer.setScissorTest(false);
    renderer.setRenderTarget(null);
    renderer.autoClear = true;
    renderer.render(scene, camera);
  };
  const moving = () => {
    if (!dynamicRoots.some(group => group.visible)) return;
    const rect = canvas.getBoundingClientRect();
    const top = Math.max(0, -rect.top), bottom = Math.min(height, innerHeight - rect.top);
    if (bottom <= top) return;
    const scale = canvas.height / height;
    renderer.setScissor(0, Math.floor((height - bottom) * scale), canvas.width, Math.ceil((bottom - top) * scale));
    renderer.setScissorTest(true);
    renderer.autoClear = false;
    renderer.clearDepth();
    const restoreDynamic = hidden(dynamicRoots);
    const materials = new Map();
    staticMeshes.forEach(mesh => {
      const values = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      values.forEach(material => {
        if (!materials.has(material)) materials.set(material, material.colorWrite);
        material.colorWrite = false;
      });
    });
    try { renderer.render(scene, camera); }
    finally {
      materials.forEach((value, material) => { material.colorWrite = value; });
      restoreDynamic();
    }
    const restoreStatic = hidden(staticMeshes);
    try { renderer.render(scene, camera); }
    finally {
      restoreStatic();
      renderer.autoClear = true;
      renderer.setScissorTest(false);
    }
  };
  function draw(time) {
    frame = 0;
    if (disposed || !contextAvailable || document.hidden) { previous = null; return; }
    const delta = previous === null ? 0 : Math.min(0.05, (time - previous) / 1000);
    previous = time;
    if (!building) {
      [...callbacks].forEach(callback => { if (callbacks.has(callback)) notify(callback, { time, delta }); });
      try {
        if (!tracer || geometryDirty) raster();
        else {
          renderer.setScissorTest(false);
          renderer.autoClear = true;
          if (phase !== 'complete') {
            if (!tracer.sample(1)) throw Error('Page ray tracing unavailable');
            if (tracer.samples >= (renderSettings.value.samples ?? AUTO_SAMPLES)) {
              phase = 'complete';
              canvas.dataset.traceFinishedAt = String(performance.now());
            }
          }
          if (phase === 'complete') tracer.present();
          moving();
        }
        status();
        dirty = false;
        if (!firstFrame) {
          firstFrame = true;
          notify(options.onFirstFrame);
        }
      } catch (error) { fail(error); }
      if (geometryDirty && traceEnabled) void rebuild();
    }
    if (building || geometryDirty || dirty || callbacks.size || (tracer && phase !== 'complete')) wake();
  }
  const invalidate = (change = {}) => {
    dirty = true;
    if (change.geometry !== false && !change.dynamic) {
      revision++;
      geometryDirty = true;
      traceEnabled = true;
      phase = 'loading';
    }
    wake();
  };
  const resize = (nextWidth, nextHeight, pixelRatio = ratio) => {
    if (disposed || !(nextWidth > 0) || !(nextHeight > 0)) return;
    const nextRatio = Math.max(0.1, Number(pixelRatio) || 1);
    if (width === nextWidth && height === nextHeight && ratio === nextRatio) return;
    width = nextWidth; height = nextHeight; ratio = nextRatio;
    const scale = Math.min(ratio * renderSettings.value.resolution,
      Math.sqrt(MAX_PIXELS / (width * height)), renderer.capabilities.maxTextureSize / Math.max(width, height));
    renderer.setSize(Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale)), false);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    camera.left = -width / 2; camera.right = width / 2;
    camera.top = 0; camera.bottom = -height;
    camera.updateProjectionMatrix();
    invalidate();
  };
  const qualityChanged = () => {
    const previousRatio = ratio;
    ratio = 0;
    resize(width, height, previousRatio);
  };
  const unsubscribe = renderSettings.subscribe(qualityChanged);
  const visibility = () => {
    previous = null;
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else { dirty = true; wake(); }
  };
  const scroll = () => { dirty = true; wake(); };
  const contextLost = event => {
    event.preventDefault();
    contextAvailable = false;
    fail(Error('Page graphics context lost'));
    cancelAnimationFrame(frame); frame = 0;
  };
  document.addEventListener('visibilitychange', visibility);
  addEventListener('scroll', scroll, { passive: true });
  canvas.addEventListener('webglcontextlost', contextLost);

  return {
    scene, camera, renderer,
    add(group, { dynamic = false } = {}) {
      if (dynamic) group.userData.dynamic = true;
      scene.add(group);
      collect();
      invalidate(dynamic && !building ? { dynamic: true } : {});
      return group;
    },
    remove(group) {
      const dynamic = group.userData.dynamic === true;
      scene.remove(group);
      collect();
      invalidate(dynamic && !building ? { dynamic: true } : {});
    },
    invalidate, resize,
    tick(callback) {
      const update = ({ time, delta }) => callback(time, delta);
      callbacks.add(update);
      wake();
      return () => callbacks.delete(update);
    },
    get state() { return phase; },
    get samples() { return tracer?.samples || 0; },
    dispose() {
      if (disposed) return;
      disposed = true;
      revision++;
      cancelAnimationFrame(frame);
      callbacks.clear();
      unsubscribe();
      document.removeEventListener('visibilitychange', visibility);
      removeEventListener('scroll', scroll);
      canvas.removeEventListener('webglcontextlost', contextLost);
      tracer?.dispose(); tracer = null;
      const resources = new Set();
      scene.traverse(object => {
        if (object.geometry) resources.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean).forEach(material => resources.add(material));
      });
      resources.forEach(resource => resource.dispose());
      scene.clear();
      renderer.dispose();
    },
  };
}
