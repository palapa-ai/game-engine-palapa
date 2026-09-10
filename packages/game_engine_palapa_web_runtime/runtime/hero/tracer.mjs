// The archive's RT_attach, with the CDN import and the CSS-variable knobs
// replaced by a relative import and a settings object. The tracer's own
// configuration is unchanged, so the image it converges to is the archive's.
import * as THREE from "./vendor/three.module.min.js";

let modP = null;
const mod = () => modP || (modP = import("./vendor/three-gpu-pathtracer.module.js"));

// Building the BVH was the last synchronous stall in attaching the tracer, so it
// runs in a worker and the page only deserialises the result.
const bvhWorker = async () => {
  const { MeshBVH } = await import("./vendor/three-mesh-bvh.module.js");
  const worker = new Worker(new URL("./bvh-worker.mjs", import.meta.url), { type: "module" });
  let running = false;
  return {
    worker,
    generate(geometry, options = {}) {
      if (running) return Promise.reject(new Error("bvh worker busy"));
      running = true;
      return new Promise((resolve, reject) => {
        const done = () => { running = false; worker.onmessage = null; worker.onerror = null; };
        worker.onerror = (e) => { done(); reject(new Error(e.message || "bvh worker failed")); };
        worker.onmessage = ({ data }) => {
          if (data.error) { done(); reject(new Error(data.error)); return; }
          if (!data.serialized) return;
          const bvh = MeshBVH.deserialize(data.serialized, geometry, { setIndex: false });
          geometry.attributes.position.array = data.position;
          if (data.serialized.index) {
            if (geometry.index) geometry.index.array = data.serialized.index;
            else geometry.setIndex(new THREE.BufferAttribute(data.serialized.index, 1, false));
          }
          geometry.boundingBox = bvh.getBoundingBox(new THREE.Box3());
          done();
          resolve(bvh);
        };
        const index = geometry.index ? geometry.index.array : null;
        const position = geometry.attributes.position.array;
        const buffers = [position.buffer];
        if (index) buffers.push(index.buffer);
        worker.postMessage(
          { index, position, options: { ...options, onProgress: null, includedProgressCallback: false, groups: [...geometry.groups] } },
          buffers.filter((b) => typeof SharedArrayBuffer === "undefined" || !(b instanceof SharedArrayBuffer)),
        );
      });
    },
  };
};

export async function attachTracer(renderer, scene, camera, cfg) {
  const { WebGLPathTracer, GradientEquirectTexture, PhysicalCamera } = await mod();

  const env = new GradientEquirectTexture();
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
  }

  const pt = new WebGLPathTracer(renderer);
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
  pt.tiles.set(cfg.tiles, cfg.tiles);
  pt.synchronizeRenderSize = true;
  pt.minSamples = 1;
  pt.filterGlossyFactor = 0.5;

  let adaptiveScale = 1;
  let bvh = null;
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    try { pt.dispose(); } catch (_) { /* release remaining owned resources */ }
    try { bvh?.worker.terminate(); } catch (_) { /* worker may already be gone */ }
    if (scene.environment === env) scene.environment = null;
    env.dispose();
  };
  try { bvh = await bvhWorker(); pt.setBVHWorker(bvh); } catch (e) { /* falls back to the main thread */ }
  const build = () => (bvh ? pt.setSceneAsync(scene, camera) : Promise.resolve(pt.setScene(scene, camera)));
  try {
    await build();
    while (pt.isCompiling) await new Promise(resolve => setTimeout(resolve, 16));
  }
  catch (error) {
    cleanup();
    throw error;
  }

  return {
    dead: false,
    camera,
    sample(count, { present = true } = {}) {
      if (this.dead) return false;
      const renderToCanvas = pt.renderToCanvas;
      pt.renderToCanvas = present;
      try {
        pt.renderScale = clampRes(adaptiveScale * cfg.rtRes / cfg.fxRes);
        for (let i = 0; i < (count || 1); i++) pt.renderSample();
        const tg = pt.target;
        if (tg && tg.texture && tg.texture.magFilter !== THREE.NearestFilter) {
          tg.texture.magFilter = THREE.NearestFilter;
          tg.texture.needsUpdate = true;
        }
        return true;
      } catch (e) {
        this.dead = true;
        scene.environment = null;
        return false;
      } finally { pt.renderToCanvas = renderToCanvas; }
    },
    setScale(scale) {
      const next = Math.min(1, Math.max(1 / 64, scale));
      if (adaptiveScale === next) return;
      adaptiveScale = next;
      pt.renderScale = clampRes(adaptiveScale * cfg.rtRes / cfg.fxRes);
      pt.reset();
    },
    setTiles(divisions) {
      if (pt.tiles.x === divisions && pt.tiles.y === divisions) return;
      pt.tiles.set(divisions, divisions);
      // The vendor captures tile dimensions for a whole sample. Restarting
      // its task applies a smaller tile immediately after an overrun.
      pt.reset();
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
    rebuild() { if (!this.dead) build().catch(() => { this.dead = true; }); },
    updateCamera() { if (this.dead) return; try { pt.updateCamera(); } catch (e) { this.dead = true; } },
    updateMaterials() { if (this.dead) return; try { pt.updateMaterials(); } catch (e) { this.dead = true; } },
    updateLights() {
      if (this.dead) return;
      try {
        if (typeof pt.updateLights === "function") pt.updateLights();
        else build().catch(() => { this.dead = true; });
      } catch (e) { this.dead = true; }
    },
    dispose() {
      this.dead = true;
      cleanup();
    },
    get scale() { return adaptiveScale; },
    get target() { return pt.target; },
    get compiling() { return !!pt.isCompiling; },
    get samples() { return pt.samples; },
  };
}
