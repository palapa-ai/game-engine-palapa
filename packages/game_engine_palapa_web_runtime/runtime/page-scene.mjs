import * as THREE from './hero/vendor/three.module.min.js';
import { attachTracer, preloadTracer } from './hero/tracer.mjs';
import { scanlineCoverage } from './hero/scanline.mjs';
import { ProgressiveTrace } from './hero/progressive-trace.mjs';
import { ProgressiveResolution } from './hero/progressive-resolution.mjs';
import { TraceReveal, TRACE_REVEAL_MS } from './hero/trace-reveal.mjs';
import { traceSampleGoal, traceResolutionConfidence, traceDisplayLimit, canPreserveTrace } from './hero/trace-confidence.mjs';
import { TraceHistory } from './hero/trace-history.mjs';
import { BackdropCache } from './hero/backdrop-cache.mjs';
import { renderSettings } from './hero/render-settings.mjs';
import { FullScreenQuad } from './hero/vendor/Pass.js';
import { FrameBudget, gpuTimer } from './hero/frame-budget.mjs';
import { cloneTraceScene, traceForeground, traceRoles, traceStageFor } from './hero/trace-scene.mjs';

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
  let resolutionPass = new ProgressiveResolution();
  const timer = gpuTimer(renderer.getContext());
  const staticTarget = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthTexture: new THREE.DepthTexture(1, 1),
  });
  const backdropCache = new BackdropCache();
  const reveal = new TraceReveal();
  const revealTexture = new THREE.DataTexture(reveal.data, 1, reveal.height, THREE.RedFormat, THREE.FloatType);
  revealTexture.minFilter = revealTexture.magFilter = THREE.NearestFilter;
  revealTexture.needsUpdate = true;
  const staticMaterial = new THREE.ShaderMaterial({
    uniforms: {
      colorMap: { value: staticTarget.texture }, depthMap: { value: staticTarget.depthTexture },
      backdropMap: { value: backdropCache.target.texture }, backdropDepth: { value: backdropCache.target.depthTexture },
      traceMap: { value: staticTarget.texture }, traceBounds: { value: new THREE.Vector4(0, 0, 1, 1) }, traceCoverage: { value: 0 },
      traceReveal: { value: revealTexture }, traceTime: { value: 0 }, traceForeground: { value: true },
      traceTextOnly: { value: renderSettings.value.traceMode === 'text' },
      traceSamples: { value: 0 }, traceFadeSamples: { value: 16 }, tracePartialCoverage: { value: 0 },
      traceResolutionConfidence: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `uniform sampler2D colorMap;
      uniform sampler2D depthMap;
      uniform sampler2D backdropMap;
      uniform sampler2D backdropDepth;
      uniform sampler2D traceMap;
      uniform vec4 traceBounds;
      uniform float traceCoverage;
      uniform sampler2D traceReveal;
      uniform float traceTime;
      uniform float traceSamples;
      uniform float traceFadeSamples;
      uniform float traceResolutionConfidence;
      uniform float tracePartialCoverage;
      uniform bool traceForeground;
      uniform bool traceTextOnly;
      varying vec2 vUv;
      void main() {
        vec2 traceUv = (vUv - traceBounds.xy) / traceBounds.zw;
        bool covered = traceCoverage > 0. && traceUv.x >= 0. && traceUv.x <= 1.
          && traceUv.y >= 1. - traceCoverage && traceUv.y <= 1.;
        vec4 base = texture2D(colorMap, vUv);
        gl_FragColor = base;
        if (covered) {
          vec4 traced = texture2D(traceMap, traceUv);
          float firstResult = texture2D(traceReveal, vec2(0.5, traceUv.y)).r;
          float pass = floor(traceSamples + 0.000001);
          float samplesHere = pass + (tracePartialCoverage > 0. && traceUv.y >= 1. - tracePartialCoverage ? 1. : 0.);
          float confidence = traceResolutionConfidence * min(1., samplesHere / traceFadeSamples);
          float weight = firstResult < 0. ? 0. : confidence * smoothstep(0., ${TRACE_REVEAL_MS / 1000}, traceTime - firstResult);
          if (traceForeground) {
            bool rasterForeground = texture2D(depthMap, vUv).r < texture2D(backdropDepth, vUv).r;
            bool foregroundPixel = rasterForeground || (!traceTextOnly && traced.a > 0.);
            if (foregroundPixel) {
              vec4 backdrop = texture2D(backdropMap, vUv);
              float combined = traced.a + backdrop.a * (1. - traced.a);
              vec3 color = combined > 0.
                ? (traced.rgb * traced.a + backdrop.rgb * backdrop.a * (1. - traced.a)) / combined : vec3(0.);
              gl_FragColor = mix(base, vec4(color, combined), weight);
            }
          } else gl_FragColor = mix(base, traced, weight);
        }
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
  const traceHistory = new TraceHistory();
  let staticDirty = true;
  const callbacks = new Set();
  let width = 0, height = 0, ratio = 1;
  let frame = 0, previous = null, tracer = null;
  let disposed = false, building = false, geometryDirty = true, dirty = true;
  let revision = 0, phase = 'starting', firstFrame = false;
  let traceStage = traceStageFor(renderSettings.value.traceMode);
  let dynamicRoots = [], staticMeshes = [], foregroundMeshes = [];
  let traceEnabled = true, contextAvailable = true;

  const resetReveal = () => {
    const nextHeight = tracer?.target.height || 1;
    if (reveal.height !== nextHeight) revealTexture.dispose();
    reveal.reset(nextHeight, tracer?.rows || 1);
    revealTexture.image = { data: reveal.data, width: 1, height: reveal.height };
    revealTexture.needsUpdate = true;
  };
  const notify = (callback, value) => {
    try { callback?.(value); } catch (error) { console.error(error); }
  };
  const collect = () => {
    dynamicRoots = [];
    staticMeshes = [];
    foregroundMeshes = [];
    const visit = (object, dynamic, inherited = 'content') => {
      const moving = dynamic || object.userData.dynamic === true;
      const role = object.userData.traceRole ?? inherited;
      if (moving && !dynamic) dynamicRoots.push(object);
      if (object.isMesh && !moving) {
        staticMeshes.push(object);
        if (traceForeground(role, renderSettings.value.traceMode)) foregroundMeshes.push(object);
      }
      object.children.forEach(child => visit(child, moving, role));
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
    canvas.dataset.traceStage = traceStage;
    canvas.dataset.traceMode = renderSettings.value.traceMode;
    const selectedSamples = renderSettings.value.samples ?? AUTO_SAMPLES;
    canvas.dataset.traceStageTargetSamples = String(traceStage === 'foreground' ? Math.min(4, selectedSamples) : resolutionPass.sampleTarget(tracer?.scale ?? budget.scale, selectedSamples));
    canvas.dataset.traceRevision = String(revision);
    canvas.dataset.traceSamples = String(tracer?.samples || 0);
    canvas.dataset.traceTargetSamples = String(renderSettings.value.samples ?? AUTO_SAMPLES);
    canvas.dataset.traceBounces = String(qualityPass.bounces);
    canvas.dataset.traceTargetBounces = String(qualityPass.target);
    canvas.dataset.sceneCount = '1';
    canvas.dataset.frameBudgetMs = String(budget.milliseconds);
    canvas.dataset.traceTiles = `1×${tracer?.rows ?? budget.rows}`;
    canvas.dataset.traceRequestedTiles = `1×${budget.tiles ** 2}`;
    canvas.dataset.traceOpacityLimit = String(traceResolutionConfidence(tracer?.target, tracer?.viewport));
    canvas.dataset.traceConfidenceSamples = String(traceSampleGoal(selectedSamples));
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
    traceHistory.reset();
    traceStage = traceStageFor(renderSettings.value.traceMode);
    resetReveal();
    qualityPass = new ProgressiveTrace(renderSettings.value.bounces);
    resolutionPass = new ProgressiveResolution();
    budget.maxTiles = 8;
    budget.resetQuality();
    budget.scale = 0.5;
    budget.setViewportHeight(visible.height);
    collect();
    staticDirty = true;
    const { scene: tracingScene, meshes } = cloneTraceScene(scene, renderSettings.value.traceMode);
    canvas.dataset.traceMeshCount = String(meshes);
    phase = 'loading';
    canvas.dataset.traceStartedAt = String(performance.now());
    delete canvas.dataset.traceFinishedAt;
    delete canvas.dataset.traceFirstSampleAt;
    delete canvas.dataset.traceForegroundFinishedAt;
    status();
    try {
      if (meshes === 0) {
        phase = 'complete';
        canvas.dataset.traceFinishedAt = String(performance.now());
        return;
      }
      const next = await attachTracer(renderer, tracingScene, camera, {
        bounces: qualityPass.bounces, rtRes: 1, fxRes: 1, tiles: budget.tiles, initialScale: budget.scale,
        dynamicLowRes: false, renderDelay: 0, scanline: true, viewport: visible,
        foregroundOnly: renderSettings.value.traceMode === 'scene',
        environmentTop: 0xd8d8d8, environmentBottom: 0xb8b8b8,
      });
      if (disposed || version !== revision) next.dispose();
      else {
        tracer = next;
        traceStage = traceStageFor(renderSettings.value.traceMode, tracer.hasBackdrop);
        tracer.setForegroundOnly(traceStage === 'foreground');
        resetReveal();
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
    try {
      renderer.render(scene, camera);
      backdropCache.refresh(renderer, scene, camera, foregroundMeshes);
      staticDirty = false;
    } finally { restore(); renderer.setRenderTarget(null); }
  };
  const composite = (time = performance.now(), sourceIndex = traceHistory.sourceIndex) => {
    const traced = tracer && !geometryDirty && tracer.samples > 0;
    staticMaterial.uniforms.colorMap.value = sourceIndex < 0 ? staticTarget.texture : history[sourceIndex].texture;
    staticMaterial.uniforms.traceMap.value = traced ? tracer.target.texture : staticTarget.texture;
    staticMaterial.uniforms.traceCoverage.value = traced
      ? scanlineCoverage(tracer.samples, tracer.target.height, tracer.rows) : 0;
    const area = tracer?.viewport;
    if (area) staticMaterial.uniforms.traceBounds.value.set(
      area.left / area.fullWidth, 1 - (area.top + area.height) / area.fullHeight,
      area.width / area.fullWidth, area.height / area.fullHeight,
    );
    staticMaterial.uniforms.traceTime.value = time / 1000;
    staticMaterial.uniforms.traceSamples.value = traced ? tracer.samples : 0;
    staticMaterial.uniforms.tracePartialCoverage.value = traced ? scanlineCoverage(tracer.samples % 1, tracer.target.height, tracer.rows) : 0;
    staticMaterial.uniforms.traceFadeSamples.value = traceSampleGoal(renderSettings.value.samples ?? AUTO_SAMPLES);
    staticMaterial.uniforms.traceResolutionConfidence.value = traced
      ? traceDisplayLimit(tracer.target, area, qualityPass.settled) : 0;
    staticMaterial.uniforms.traceForeground.value = traceStage !== 'background';
    staticMaterial.uniforms.traceTextOnly.value = renderSettings.value.traceMode === 'text';
  };
  const captureHistory = (time, transient = false) => {
    cacheStatic();
    traceHistory.capture((targetIndex, sourceIndex) => {
      composite(time, sourceIndex);
      history[targetIndex].setSize(canvas.width, canvas.height);
      renderer.setScissorTest(false);
      renderer.setRenderTarget(history[targetIndex]);
      renderer.autoClear = true;
      try { historyQuad.render(renderer); }
      finally { renderer.setRenderTarget(null); }
    }, { transient });
  };
  const preserve = (time = performance.now()) => {
    if (!tracer || !canPreserveTrace({
      samples: tracer.samples,
      selectedSamples: renderSettings.value.samples ?? AUTO_SAMPLES,
      resolutionConfidence: traceResolutionConfidence(tracer.target, tracer.viewport),
      qualitySettled: qualityPass.settled && tracer.bounces === qualityPass.target,
      revealSettled: reveal.settled(time),
    })) return;
    captureHistory(time);
  };
  const present = (visible, time) => {
    cacheStatic();
    renderer.setRenderTarget(null);
    renderer.setScissor(visible.left, canvas.height - visible.top - visible.height, visible.width, visible.height);
    renderer.setScissorTest(true);
    renderer.autoClear = true;
    composite(time);
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
      else budget.ray(null, result.milliseconds, result.tiles, result.scale, result.bands, result.epoch, result.rows);
    }
    const delta = previous === null ? 0 : Math.min(0.05, (time - previous) / 1000);
    previous = time;
    [...callbacks].forEach(callback => { if (callbacks.has(callback)) notify(callback, { time, delta }); });
    try {
      const visible = viewport();
      if (tracer && visible.width > 0 && visible.height > 0 && !sameViewport(tracer.viewport, visible)) {
        preserve(time);
        traceHistory.clearTransient();
        budget.maxTiles = 8;
        budget.resetQuality();
        budget.scale = 0.5;
        budget.setViewportHeight(visible.height);
        tracer.setScale(budget.scale);
        tracer.setTiles(budget.tiles);
        tracer.setViewport(visible);
        traceStage = traceStageFor(renderSettings.value.traceMode, tracer.hasBackdrop);
        tracer.setForegroundOnly(traceStage === 'foreground');
        budget.resetBatchMeasurements();
        qualityPass = new ProgressiveTrace(renderSettings.value.bounces);
        resolutionPass = new ProgressiveResolution();
        tracer.setBounces(qualityPass.bounces);
        resetReveal();
        phase = 'tracing';
        canvas.dataset.traceStartedAt = String(performance.now());
        delete canvas.dataset.traceFinishedAt;
        delete canvas.dataset.traceFirstSampleAt;
        delete canvas.dataset.traceForegroundFinishedAt;
      }
      timer.begin('paint');
      try { present(visible, time); moving(); }
      finally { timer.end(); }
      dirty = false;
      if (!firstFrame) { firstFrame = true; notify(options.onFirstFrame); }
      if (tracer && visible.width > 0 && visible.height > 0 && !building && !geometryDirty && phase !== 'complete' && !tracer.compiling) {
        // Apply measured workload changes before considering a resolution probe.
        // Otherwise a new probe can overwrite a downgrade from the GPU timer.
        const workloadChanged = tracer.divisions !== budget.tiles || tracer.scale !== budget.scale;
        if (workloadChanged) {
          preserve(time);
          tracer.setTiles(budget.tiles);
          tracer.setScale(budget.scale);
          resetReveal();
        }
        const target = renderSettings.value.samples ?? AUTO_SAMPLES;
        const foregroundComplete = qualityPass.settled && tracer.samples >= Math.min(4, target);
        const stageComplete = qualityPass.settled && (traceStage === 'foreground'
          ? foregroundComplete : resolutionPass.complete({ samples: tracer.samples, scale: tracer.scale, targetSamples: target }));
        const refinement = traceStage !== 'foreground' && qualityPass.settled && reveal.settled(time)
          ? resolutionPass.advance({ samples: tracer.samples, scale: tracer.scale, tiles: budget.tiles, now: time, targetSamples: target }) : null;
        const sampleLimit = traceStage === 'foreground' ? Math.min(4, target) : target;
        const batch = stageComplete || refinement || (qualityPass.settled && tracer.samples >= sampleLimit)
          ? 0 : budget.batch(performance.now(), timer.busy);
        if (refinement) {
          preserve(time);
          budget.scale = refinement.scale;
          budget.tiles = refinement.tiles;
          budget.maxTiles = Math.max(budget.maxTiles, refinement.tiles);
          budget.resetBatchMeasurements();
          tracer.setTiles(budget.tiles);
          tracer.setScale(budget.scale);
          resetReveal();
          dirty = true;
        } else if (stageComplete && reveal.settled(time)) {
          if (traceStage === 'foreground') {
            captureHistory(time, true);
            traceStage = 'background';
            canvas.dataset.traceForegroundFinishedAt = String(performance.now());
            tracer.setForegroundOnly(false);
            budget.resetBatchMeasurements();
            resetReveal();
            dirty = true;
          } else {
            phase = 'complete';
            canvas.dataset.traceFinishedAt = String(performance.now());
          }
        } else if (batch > 0) {
          let reset = workloadChanged;
          if (qualityPass.advance(tracer.samples)) {
            preserve(time);
            tracer.setBounces(qualityPass.bounces);
            budget.resetBatchMeasurements();
            reset = true;
          }
          if (reset) resetReveal();
          const started = performance.now(), divisions = budget.tiles;
          const previousSamples = tracer.samples;
          // End at a sample boundary so quality/stage changes keep their order.
          const remainingBands = Math.max(1, Math.round((Math.floor(previousSamples) + 1 - previousSamples) * tracer.rows));
          const bands = Math.min(reset ? 1 : batch, remainingBands);
          const epoch = budget.measurementEpoch;
          const rows = tracer.rows;
          timer.begin('ray', { tiles: divisions, scale: budget.scale, epoch, rows });
          let sampled, submittedBands = 0;
          try { sampled = tracer.sample(bands, { present: false }); }
          finally {
            submittedBands = Math.round((tracer.samples - previousSamples) * tracer.rows);
            timer.end({ bands: submittedBands });
          }
          if (tracer.samples > previousSamples) {
            const resultTime = performance.now();
            canvas.dataset.traceFirstSampleAt ||= String(resultTime);
            if (reveal.observe(tracer.samples, resultTime)) revealTexture.needsUpdate = true;
            budget.submitted();
            if (previousSamples > 0) budget.ray(performance.now() - started, null, divisions, tracer.scale, submittedBands, epoch, rows);
          }
          if (!sampled) throw Error('Page ray tracing unavailable');
          dirty = true;
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
    backdropCache.resize(canvas.width, canvas.height);
    staticDirty = true;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    camera.left = -width / 2; camera.right = width / 2;
    camera.top = 0; camera.bottom = -height;
    camera.updateProjectionMatrix();
    invalidate();
  };
  const qualityChanged = () => {
    traceHistory.reset();
    tracer?.dispose(); tracer = null;
    resetReveal();
    traceStage = traceStageFor(renderSettings.value.traceMode);
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
    add(group, { dynamic = false, role } = {}) {
      if (role !== undefined) {
        if (!traceRoles.includes(role)) throw RangeError('Unknown trace role');
        group.userData.traceRole = role;
      }
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
      traceHistory.clearTransient();
      qualityPass = new ProgressiveTrace(renderSettings.value.bounces);
      resolutionPass = new ProgressiveResolution();
      budget.maxTiles = 8;
      budget.resetQuality();
      budget.scale = 0.5;
      traceStage = traceStageFor(renderSettings.value.traceMode, tracer?.hasBackdrop);
      tracer?.setForegroundOnly(traceStage === 'foreground');
      tracer?.setBounces(1);
      tracer?.setTiles(budget.tiles);
      tracer?.setScale(budget.scale);
      tracer?.reset();
      resetReveal();
      if (tracer) phase = 'tracing';
      canvas.dataset.traceStartedAt = String(performance.now());
      delete canvas.dataset.traceFinishedAt;
      delete canvas.dataset.traceFirstSampleAt;
      delete canvas.dataset.traceForegroundFinishedAt;
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
      backdropCache.dispose();
      revealTexture.dispose();
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
