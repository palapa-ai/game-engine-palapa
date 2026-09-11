import * as THREE from './hero/vendor/three.module.min.js';
import { attachTracer, preloadTracer } from './hero/tracer.mjs';
import { scanlineCoverage } from './hero/scanline.mjs';
import { ProgressiveTrace } from './hero/progressive-trace.mjs';
import { renderSettings } from './hero/render-settings.mjs';
import { FullScreenQuad } from './hero/vendor/Pass.js';
import { FrameBudget, gpuTimer } from './hero/frame-budget.mjs';

const MAX_PIXELS = 3000000;
const AUTO_SAMPLES = 64;

// Broad reflected light for moving metal, matching the static tracer's sky.
// Build and prefilter once; animated frames only sample the resulting texture.
function softEnvironment(renderer) {
  const width = 64, height = 32, data = new Float32Array(width * height * 4);
  const top = new THREE.Color(0xd8d8d8), bottom = new THREE.Color(0xb8b8b8), color = new THREE.Color();
  for (let y = 0; y < height; y++) {
    const weight = ((1 - Math.cos(Math.PI * y / (height - 1))) / 2) ** 2;
    color.copy(bottom).lerp(top, weight);
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data.set([color.r, color.g, color.b, 1], offset);
    }
  }
  const source = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.needsUpdate = true;
  const generator = new THREE.PMREMGenerator(renderer);
  try { return generator.fromEquirectangular(source); }
  finally { source.dispose(); generator.dispose(); }
}

export function createPageScene(canvas, options = {}) {
  void preloadTracer().catch(() => {});
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  const environment = softEnvironment(renderer);
  scene.environment = environment.texture;
  const camera = new THREE.OrthographicCamera(-1, 1, 0, -1, 0.1, 10000);
  camera.position.z = 2000;
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b8b8, 0.7));

  const budget = new FrameBudget({ tiles: 2, maxTiles: 8 });
  budget.scale = 0.5;
  let qualityPass = new ProgressiveTrace(renderSettings.value.bounces);
  const timer = gpuTimer(renderer.getContext());
  const staticTarget = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthTexture: new THREE.DepthTexture(1, 1),
  });
  const staticMaterial = new THREE.ShaderMaterial({
    uniforms: {
      colorMap: { value: staticTarget.texture }, depthMap: { value: staticTarget.depthTexture },
      traceMap: { value: staticTarget.texture }, traceBounds: { value: new THREE.Vector4(0, 0, 1, 1) }, traceCoverage: { value: 0 }, traceOpacity: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `uniform sampler2D colorMap;
      uniform sampler2D depthMap;
      uniform sampler2D traceMap;
      uniform vec4 traceBounds;
      uniform float traceCoverage;
      uniform float traceOpacity;
      varying vec2 vUv;
      void main() {
        vec2 traceUv = (vUv - traceBounds.xy) / traceBounds.zw;
        bool covered = traceCoverage > 0. && traceUv.x >= 0. && traceUv.x <= 1.
          && traceUv.y >= 1. - traceCoverage && traceUv.y <= 1.;
        gl_FragColor = covered
          ? mix(texture2D(colorMap, vUv), texture2D(traceMap, traceUv), traceOpacity) : texture2D(colorMap, vUv);
        gl_FragDepth = texture2D(depthMap, vUv).r;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <premultiplied_alpha_fragment>
      }`,
    premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
    blending: THREE.NoBlending, depthFunc: THREE.AlwaysDepth, depthTest: true, depthWrite: true,
  });
  const staticQuad = new FullScreenQuad(staticMaterial);
  const history = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
  const historyMaterial = new THREE.ShaderMaterial({
    uniforms: staticMaterial.uniforms,
    vertexShader: staticMaterial.vertexShader,
    fragmentShader: staticMaterial.fragmentShader
      .replace('gl_FragDepth = texture2D(depthMap, vUv).r;', '')
      .replace('#include <tonemapping_fragment>', '')
      .replace('#include <colorspace_fragment>', '')
      .replace('#include <premultiplied_alpha_fragment>', ''),
    blending: THREE.NoBlending, depthTest: false, depthWrite: false,
  });
  const historyQuad = new FullScreenQuad(historyMaterial);
  let historyIndex = -1;
  let staticDirty = true;
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
    canvas.dataset.traceBounces = String(qualityPass.bounces);
    canvas.dataset.traceTargetBounces = String(qualityPass.target);
    canvas.dataset.sceneCount = '1';
    canvas.dataset.frameBudgetMs = String(budget.milliseconds);
    canvas.dataset.traceTiles = `1×${budget.tiles ** 2}`;
    canvas.dataset.traceScanline = String(staticMaterial.uniforms.traceCoverage.value);
    canvas.dataset.traceGpuTiming = timer.supported ? 'available' : 'unavailable';
    canvas.dataset.traceSkippedFrames = String(budget.skipped);
    canvas.dataset.paintGpuMs = budget.paintGpuMs.toFixed(2);
    canvas.dataset.traceTileGpuMs = budget.rayGpuMs.toFixed(2);
    canvas.dataset.traceResolutionScale = String(budget.scale);
    canvas.dataset.traceProbeCount = String(budget.probes);
    canvas.dataset.traceGpuPending = String(timer.busy);
    canvas.dataset.traceWidth = String(tracer?.target?.width || 0);
    canvas.dataset.traceHeight = String(tracer?.target?.height || 0);
    canvas.dataset.traceViewport = JSON.stringify(tracer?.viewport ?? null);
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
  const viewport = () => {
    const rect = canvas.getBoundingClientRect();
    const left = Math.max(0, -rect.left), top = Math.max(0, -rect.top);
    const right = Math.min(width, innerWidth - rect.left), bottom = Math.min(height, innerHeight - rect.top);
    const scaleX = canvas.width / width, scaleY = canvas.height / height;
    return {
      left: Math.floor(left * scaleX), top: Math.floor(top * scaleY),
      width: Math.max(0, Math.ceil(right * scaleX) - Math.floor(left * scaleX)),
      height: Math.max(0, Math.ceil(bottom * scaleY) - Math.floor(top * scaleY)),
      fullWidth: canvas.width, fullHeight: canvas.height,
    };
  };
  const sameViewport = (a, b) => a && Object.keys(b).every(key => a[key] === b[key]);
  const rebuild = async () => {
    if (building || disposed || !traceEnabled || tracer?.compiling) return;
    const visible = viewport();
    if (visible.width <= 0 || visible.height <= 0) return;
    building = true;
    geometryDirty = false;
    const version = revision;
    tracer?.dispose(); tracer = null;
    historyIndex = -1;
    qualityPass = new ProgressiveTrace(renderSettings.value.bounces);
    budget.resetQuality();
    budget.scale = 0.5;
    collect();
    staticDirty = true;
    const tracingScene = scene.clone(true);
    const movingCopies = [];
    tracingScene.traverse(object => { if (object.userData.dynamic) movingCopies.push(object); });
    movingCopies.forEach(object => object.removeFromParent());
    phase = 'loading';
    canvas.dataset.traceStartedAt = String(performance.now());
    delete canvas.dataset.traceFinishedAt;
    delete canvas.dataset.traceFirstSampleAt;
    status();
    try {
      const next = await attachTracer(renderer, tracingScene, camera, {
        bounces: qualityPass.bounces, rtRes: 1, fxRes: 1, tiles: budget.tiles, initialScale: budget.scale,
        dynamicLowRes: false, renderDelay: 0, scanline: true, viewport: visible,
        environmentTop: 0xd8d8d8, environmentBottom: 0xb8b8b8,
      });
      if (disposed || version !== revision) next.dispose();
      else {
        tracer = next;
        phase = 'tracing';
      }
    } catch (error) {
      if (!disposed && version === revision) fail(error);
    } finally {
      building = false;
      dirty = true;
      status();
      wake();
    }
  };
  const cacheStatic = () => {
    if (!staticDirty) return;
    const restore = hidden(dynamicRoots);
    renderer.setScissorTest(false);
    renderer.setRenderTarget(staticTarget);
    renderer.autoClear = true;
    try { renderer.render(scene, camera); staticDirty = false; }
    finally { restore(); renderer.setRenderTarget(null); }
  };
  const composite = () => {
    const traced = tracer && !geometryDirty && tracer.samples > 0;
    staticMaterial.uniforms.colorMap.value = historyIndex < 0 ? staticTarget.texture : history[historyIndex].texture;
    staticMaterial.uniforms.traceMap.value = traced ? tracer.target.texture : staticTarget.texture;
    staticMaterial.uniforms.traceCoverage.value = traced
      ? scanlineCoverage(tracer.samples, tracer.target.height, tracer.rows) : 0;
    const area = tracer?.viewport;
    if (area) staticMaterial.uniforms.traceBounds.value.set(
      area.left / area.fullWidth, 1 - (area.top + area.height) / area.fullHeight,
      area.width / area.fullWidth, area.height / area.fullHeight,
    );
    const fadeSamples = Math.min(4, renderSettings.value.samples ?? AUTO_SAMPLES);
    staticMaterial.uniforms.traceOpacity.value = traced ? Math.min(1, tracer.samples / fadeSamples) : 0;
  };
  const preserve = () => {
    if (!tracer || tracer.samples <= 0) return;
    cacheStatic();
    composite();
    const next = (historyIndex + 1) % history.length;
    history[next].setSize(canvas.width, canvas.height);
    renderer.setScissorTest(false);
    renderer.setRenderTarget(history[next]);
    renderer.autoClear = true;
    historyQuad.render(renderer);
    renderer.setRenderTarget(null);
    historyIndex = next;
  };
  const present = visible => {
    cacheStatic();
    renderer.setRenderTarget(null);
    renderer.setScissor(visible.left, canvas.height - visible.top - visible.height, visible.width, visible.height);
    renderer.setScissorTest(true);
    renderer.autoClear = true;
    composite();
    renderer.clear();
    renderer.autoClear = false;
    staticQuad.render(renderer);
    renderer.setScissorTest(false);
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
    if (disposed || !contextAvailable || document.hidden) { previous = null; budget.resetCadence(); return; }
    budget.begin(time);
    for (const result of timer.poll()) {
      if (result.kind === 'paint') budget.paint(result.milliseconds);
      else budget.ray(null, result.milliseconds, result.tiles, result.scale);
    }
    const delta = previous === null ? 0 : Math.min(0.05, (time - previous) / 1000);
    previous = time;
    [...callbacks].forEach(callback => { if (callbacks.has(callback)) notify(callback, { time, delta }); });
    try {
      const visible = viewport();
      if (tracer && visible.width > 0 && visible.height > 0 && !sameViewport(tracer.viewport, visible)) {
        preserve();
        tracer.setViewport(visible);
        qualityPass = new ProgressiveTrace(renderSettings.value.bounces);
        tracer.setBounces(qualityPass.bounces);
        phase = 'tracing';
        canvas.dataset.traceStartedAt = String(performance.now());
        delete canvas.dataset.traceFinishedAt;
        delete canvas.dataset.traceFirstSampleAt;
      }
      timer.begin('paint');
      try { present(visible); moving(); }
      finally { timer.end(); }
      dirty = false;
      if (!firstFrame) { firstFrame = true; notify(options.onFirstFrame); }
      if (tracer && visible.width > 0 && visible.height > 0 && !building && !geometryDirty && phase !== 'complete' && !tracer.compiling) {
        if (budget.allows(performance.now(), timer.busy)) {
          if (tracer.rows !== budget.tiles ** 2 || tracer.scale !== budget.scale) preserve();
          tracer.setTiles(budget.tiles);
          tracer.setScale(budget.scale);
          if (qualityPass.advance(tracer.samples)) {
            preserve();
            tracer.setBounces(qualityPass.bounces);
          }
          const started = performance.now(), divisions = budget.tiles;
          timer.begin('ray', { tiles: divisions, scale: budget.scale });
          let sampled;
          const previousSamples = tracer.samples;
          try { sampled = tracer.sample(1, { present: false }); }
          finally { timer.end(); }
          if (tracer.samples > previousSamples) {
            canvas.dataset.traceFirstSampleAt ||= String(performance.now());
            budget.submitted();
            if (previousSamples > 0) budget.ray(performance.now() - started);
          }
          if (!sampled) throw Error('Page ray tracing unavailable');
          dirty = true;
          if (qualityPass.settled && tracer.samples >= (renderSettings.value.samples ?? AUTO_SAMPLES)) {
            phase = 'complete';
            canvas.dataset.traceFinishedAt = String(performance.now());
          }
        }
      }
      status();
    } catch (error) { fail(error); }
    budget.finish(performance.now());
    if (geometryDirty && traceEnabled) void rebuild();
    const visible = viewport();
    if (visible.width > 0 && visible.height > 0 &&
        (building || geometryDirty || dirty || callbacks.size || (tracer && phase !== 'complete'))) wake();
  }
  const invalidate = (change = {}) => {
    dirty = true;
    if (!change.dynamic) {
      collect();
      staticDirty = true;
    }
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
    staticTarget.setSize(canvas.width, canvas.height);
    staticDirty = true;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    camera.left = -width / 2; camera.right = width / 2;
    camera.top = 0; camera.bottom = -height;
    camera.updateProjectionMatrix();
    invalidate();
  };
  const qualityChanged = () => {
    budget.resetQuality();
    const previousRatio = ratio;
    ratio = 0;
    resize(width, height, previousRatio);
  };
  const unsubscribe = renderSettings.subscribe(qualityChanged);
  const visibility = () => {
    previous = null;
    budget.resetCadence();
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
    resetTracingQuality() {
      preserve();
      qualityPass = new ProgressiveTrace(renderSettings.value.bounces);
      budget.resetQuality();
      budget.scale = 0.5;
      tracer?.setBounces(1);
      tracer?.setTiles(budget.tiles);
      tracer?.setScale(budget.scale);
      if (tracer) phase = 'tracing';
      canvas.dataset.traceStartedAt = String(performance.now());
      delete canvas.dataset.traceFinishedAt;
      delete canvas.dataset.traceFirstSampleAt;
      dirty = true;
      wake();
    },
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
      timer.dispose();
      environment.dispose();
      staticTarget.dispose();
      staticQuad.dispose();
      staticMaterial.dispose();
      history.forEach(target => target.dispose());
      historyQuad.dispose();
      historyMaterial.dispose();
      scene.clear();
      renderer.dispose();
    },
  };
}
