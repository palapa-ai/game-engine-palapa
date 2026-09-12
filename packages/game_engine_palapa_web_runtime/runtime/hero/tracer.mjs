// The archive's RT_attach, with the CDN import and the CSS-variable knobs
// replaced by a relative import and a settings object. The tracer's own
// configuration is unchanged, so the image it converges to is the archive's.
import * as THREE from "./vendor/three.module.min.js";
import { prepareTraceBackdrop } from "./trace-backdrop.mjs";
import { scanlineRows } from "./scanline.mjs";
import { normalizeTraceViewport, sameTraceViewport, traceViewportSize, applyTraceViewport } from "./trace-viewport.mjs";
import { traceError } from "./trace-failure.mjs";

let modP = null;
const mod = () => modP || (modP = import("./vendor/three-gpu-pathtracer.module.js"));
export const preloadTracer = () => mod();

// Keep BVH work off the presentation thread and make its lifetime cancellable.
const bvhWorker = async () => {
  const { BvhBuild } = await import('./bvh-build.mjs');
  return new BvhBuild();
};

export async function attachTracer(renderer, scene, camera, cfg) {
  cfg.signal?.throwIfAborted();
  const sourceCamera = camera;
  let viewport = normalizeTraceViewport(cfg.viewport);
  if (viewport && !camera.isOrthographicCamera) throw new TypeError("Trace viewports require an orthographic camera");
  const { WebGLPathTracer, GradientEquirectTexture, PhysicalCamera } = await mod();

  cfg.signal?.throwIfAborted();
  let env = null, backdrop = null, pt = null, bvh = null, disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    cfg.signal?.removeEventListener('abort', abort);
    try { bvh?.dispose(cfg.signal?.reason); } catch (_) { /* release remaining owned resources */ }
    try { pt?.dispose(); } catch (_) { /* release remaining owned resources */ }
    if (scene.environment === env) scene.environment = null;
    env?.dispose();
    backdrop?.dispose();
  };
  const abort = () => cleanup();
  cfg.signal?.addEventListener('abort', abort, { once: true });
  try {
    env = new GradientEquirectTexture();
    env.topColor.set(cfg.environmentTop ?? 0xbfbfbf);
    env.bottomColor.set(cfg.environmentBottom ?? 0x0d0d0d);
    env.update();
    scene.environment = env;
    scene.environmentIntensity = 1;
    // Missed camera rays expose the page wall without removing environment lighting.
    scene.background = null;

    if (camera.isPerspectiveCamera) {
      const cam = new PhysicalCamera(camera.fov, camera.aspect, camera.near, camera.far);
      cam.copy(camera);
      cam.bokehSize = 0;
      cam.updateProjectionMatrix();
      camera = cam;
    } else if (camera.isOrthographicCamera) {
      camera = camera.clone();
    }
    const syncCamera = () => {
      if (camera.isOrthographicCamera) applyTraceViewport(camera, sourceCamera, viewport);
    };
    syncCamera();

    backdrop = prepareTraceBackdrop(scene, cfg.foregroundOnly);
    pt = new WebGLPathTracer(renderer);
    // Cap the render target at the device's max texture size — oversized float
    // targets are silently rejected on iOS (or OOM the tab).
    const gl = renderer.getContext();
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const db = new THREE.Vector2();
    const clampRes = (r) => {
      renderer.getDrawingBufferSize(db);
      return Math.min(r, maxTex / Math.max(db.x, db.y));
    };

    pt.bounces = cfg.bounces;
    // rtRes counts 516-wide layout units, so the trace stays put when fxRes moves.
    pt.renderScale = clampRes(cfg.rtRes / cfg.fxRes);
    // Instant chunky preview: one low-res pass composites while full-res accumulates.
    pt.dynamicLowRes = cfg.dynamicLowRes ?? true;
    pt.renderDelay = cfg.renderDelay ?? 100;
    pt.lowResScale = 0.25;
    pt.fadeDuration = 900;
    // One renderSample() traces one tile, so more tiles = less work per frame.
    let divisions = cfg.tiles;
    const syncTiles = () => {
      const columns = cfg.scanline ? 1 : divisions;
      const rows = cfg.scanline ? scanlineRows(divisions, pt.target.height) : divisions;
      if (pt.tiles.x === columns && pt.tiles.y === rows) return false;
      pt.tiles.set(columns, rows);
      pt.reset();
      return true;
    };
    pt.synchronizeRenderSize = !viewport;
    pt.minSamples = 1;
    pt.filterGlossyFactor = 0.5;

    let adaptiveScale = cfg.initialScale ?? 1;
    pt.renderScale = clampRes(adaptiveScale * cfg.rtRes / cfg.fxRes);
    const syncViewportSize = () => {
      if (viewport) {
        const size = traceViewportSize(viewport, adaptiveScale * cfg.rtRes / cfg.fxRes, maxTex);
        pt.setSize(size.width, size.height);
      } else if (cfg.scanline) {
        // Also size legacy scanline targets before clamping their tile count.
        renderer.getDrawingBufferSize(db);
        pt.setSize(Math.max(1, Math.floor(db.x * pt.renderScale)), Math.max(1, Math.floor(db.y * pt.renderScale)));
      }
      syncTiles();
    };
    syncViewportSize();
    try {
      const builder = await bvhWorker();
      if (disposed) { builder.dispose(cfg.signal?.reason); cfg.signal?.throwIfAborted(); }
      bvh = builder;
      pt.setBVHWorker(bvh);
    } catch (error) {
      cfg.signal?.throwIfAborted();
      bvh?.dispose(); bvh = null;
      // Browsers without module workers still use the synchronous builder.
    }
    const build = () => {
      syncCamera();
      return bvh ? pt.setSceneAsync(scene, camera) : Promise.resolve(pt.setScene(scene, camera));
    };
    try {
      await build();
      while (pt.isCompiling) {
        cfg.signal?.throwIfAborted();
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      cfg.signal?.throwIfAborted();
    }
    catch (error) {
      cleanup();
      if (cfg.signal?.aborted) throw cfg.signal.reason;
      throw traceError(error, 'Scene build');
    }

    let failure = null;
    const failed = (error, operation) => { failure ||= traceError(error, operation); };
    return {
      dead: false,
      camera,
      sample(count, { present = true } = {}) {
        if (this.dead) return false;
        const renderToCanvas = pt.renderToCanvas;
        pt.renderToCanvas = present;
        try {
          pt.renderScale = clampRes(adaptiveScale * cfg.rtRes / cfg.fxRes);
          syncViewportSize();
          if (cfg.scanline && count > 1 && count <= 4) pt.renderSample(count);
          else for (let i = 0; i < (count || 1); i++) pt.renderSample();
          const tg = pt.target;
          if (tg && tg.texture && tg.texture.magFilter !== THREE.NearestFilter) {
            tg.texture.magFilter = THREE.NearestFilter;
            tg.texture.needsUpdate = true;
          }
          return true;
        } catch (e) {
          failed(e, 'Sampling');
          this.dead = true;
          scene.environment = null;
          return false;
        } finally { pt.renderToCanvas = renderToCanvas; }
      },
      reset() { if (!this.dead) pt.reset(); },
      setScale(scale) {
        const next = Math.min(1, Math.max(1 / 64, scale));
        if (adaptiveScale === next) return;
        adaptiveScale = next;
        pt.renderScale = clampRes(adaptiveScale * cfg.rtRes / cfg.fxRes);
        syncViewportSize();
        pt.reset();
      },
      setViewport(value) {
        const next = normalizeTraceViewport(value);
        if (sameTraceViewport(viewport, next)) return false;
        if (next && !camera.isOrthographicCamera) throw new TypeError("Trace viewports require an orthographic camera");
        viewport = next;
        pt.synchronizeRenderSize = !viewport;
        syncCamera();
        pt.updateCamera();
        syncViewportSize();
        return true;
      },
      setForegroundOnly(value) {
        if (!backdrop.setForegroundOnly(value)) return false;
        pt.updateMaterials();
        return true;
      },
      setBounces(bounces) {
        if (pt.bounces === bounces) return;
        pt.bounces = bounces;
        pt.reset();
      },
      setTiles(value) {
        divisions = value;
        // The vendor captures tile dimensions for a whole sample. Restarting
        // its task applies a smaller tile immediately after an overrun.
        syncTiles();
      },
      present() {
        const pause = pt.pausePathTracing, fade = pt.fadeDuration;
        try {
          pt.pausePathTracing = true;
          pt.fadeDuration = 0;
          renderer.setRenderTarget(null);
          renderer.clear();
          pt.renderSample();
        } finally { pt.pausePathTracing = pause; pt.fadeDuration = fade; }
      },
      rebuild() { if (!this.dead) build().catch(error => { failed(error, 'Scene rebuild'); this.dead = true; }); },
      updateCamera() { if (this.dead) return; try { syncCamera(); pt.updateCamera(); } catch (e) { failed(e, 'Camera update'); this.dead = true; } },
      updateMaterials() { if (this.dead) return; try { pt.updateMaterials(); } catch (e) { failed(e, 'Material update'); this.dead = true; } },
      updateLights() {
        if (this.dead) return;
        try {
          if (typeof pt.updateLights === "function") pt.updateLights();
          else build().catch(error => { failed(error, 'Light rebuild'); this.dead = true; });
        } catch (e) { failed(e, 'Light update'); this.dead = true; }
      },
      dispose() {
        this.dead = true;
        cleanup();
      },
      get foregroundOnly() { return backdrop.foregroundOnly; },
      get error() { return failure; },
      get hasBackdrop() { return backdrop.hasBackdrop; },
      get viewport() { return viewport; },
      get bounces() { return pt.bounces; },
      get rows() { return pt.tiles.y; },
      get divisions() { return divisions; },
      get scale() { return adaptiveScale; },
      get target() { return pt.target; },
      get compiling() { return !!pt.isCompiling; },
      get samples() { return pt.samples; },
      get cameraRays() { return pt.cameraRays; },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
