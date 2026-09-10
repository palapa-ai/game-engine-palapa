import * as THREE from "./vendor/three.module.min.js";
import { FullScreenQuad } from "./vendor/Pass.js";


const YAW_LIMIT = 0.3;
const PITCH_LIMIT = 0.14;
const REST = { yaw: 0.09, pitch: 0.025 };
const POSE_SETTLE_MS = 150;
const clamp = (v, lim) => Math.max(-lim, Math.min(lim, Number.isFinite(v) ? v : 0));

// The archive's sway: the camera orbits the origin rather than the lockup turning.
const sway = (cm, baseZ, pitch, yaw) => {
  cm.position.set(
    Math.sin(yaw) * Math.cos(pitch) * baseZ,
    Math.sin(pitch) * baseZ,
    Math.cos(yaw) * Math.cos(pitch) * baseZ,
  );
  cm.lookAt(0, 0, 0);
};

// three-gpu-pathtracer's own canvas blit, which it does not export: encode per
// texel before interpolating, so a stretched float target does not bloom on its
// bright pixels. The sRGB transfer is spelled out rather than left to three's
// `linearToOutputTexel`, which a ShaderMaterial cannot count on being given.
const blitMaterial = () => new THREE.ShaderMaterial({
  uniforms: { map: { value: null } },
  depthTest: false,
  depthWrite: false,
  blending: THREE.NoBlending,
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: `
    uniform sampler2D map;
    varying vec2 vUv;
    vec4 fetch( ivec2 px ) {
      vec4 res = texelFetch( map, px, 0 );
      vec3 v = max( res.rgb, vec3( 0.0 ) );
      res.rgb = mix( pow( v, vec3( 0.41666 ) ) * 1.055 - 0.055, v * 12.92, vec3( lessThanEqual( v, vec3( 0.0031308 ) ) ) );
      res.rgb *= res.a;
      return res;
    }
    void main() {
      vec2 size = vec2( textureSize( map, 0 ) );
      vec2 pxUv = vUv * size;
      vec2 pxCurr = floor( pxUv );
      vec2 pxFrac = fract( pxUv ) - 0.5;
      vec2 pxOffset = vec2( pxFrac.x > 0.0 ? 1.0 : -1.0, pxFrac.y > 0.0 ? 1.0 : -1.0 );
      vec2 pxNext = clamp( pxOffset + pxCurr, vec2( 0.0 ), size - 1.0 );
      vec2 a = abs( pxFrac );
      vec4 p1 = mix( fetch( ivec2( pxCurr ) ), fetch( ivec2( pxNext.x, pxCurr.y ) ), a.x );
      vec4 p2 = mix( fetch( ivec2( pxCurr.x, pxNext.y ) ), fetch( ivec2( pxNext ) ), a.x );
      gl_FragColor = mix( p1, p2, a.y );
    }`,
});

export function createSceneSurface(canvas, definition, options = {}) {
  const { defaults: DEFAULTS, layout, buildScene: buildHeroScene, loadFont: loadScriptFont } = definition;
  const buildRenderer = canvas => {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    renderer.setClearColor(0x000000, 0);
    return renderer;
  };
  const opt = {
    ...DEFAULTS,
    scriptFont: definition.fontUrl,
    viewportHeight: null,
    denoise: true,
    denoiseAtSamples: 8,
    cleanSamples: 128,
    bounces: 4,
    tiles: 2,
    pointerDrag: true,
    ...options,
  };
  const t0 = performance.now();
  const since = () => Math.round(performance.now() - t0);

  const state = {
    phase: "starting",
    tier: null,
    yaw: REST.yaw,
    pitch: REST.pitch,
    timings: {},
    samples: 0,
  };

  let raf = 0;
  let disposed = false;
  let renderer = null;
  let built = null;      // the raster scene, once the font is in
  let tracer = null;
  let backend = null;
  let unet = null;
  let unetTile = 0;
  let auxPass = null;
  let denoiseTex = null;
  let denoiseQuad = null;
  let denoising = false;
  let abortDenoise = null;
  let posePresented = -1;
  let poseSerial = 0;
  let dragging = false;
  let visible = false;
  let foreground = true;
  let generation = 0;
  let backdrop = null;
  let backdropQuad = null;
  let poseSettleAt = 0;
  let poseTimer = 0;
  const bufferSize = new THREE.Vector2();
  const copyOrigin = new THREE.Vector2();
  let box = { w: 0, h: 0, dpr: 1 };
  let natural = null;
  let pending = null;

  canvas.dataset.staticTrace = "hero";
  const active = () => !disposed && state.phase !== "failed" && foreground && visible && !document.hidden;
  const wake = () => {
    if (!raf && active()) raf = requestAnimationFrame(frame);
  };
  const diagnostic = () => {
    canvas.dataset.render = state.phase === "ready" ? "complete"
      : state.phase === "raster" && state.tier === "raster" ? "fallback" : state.phase;
    canvas.dataset.samples = String(state.samples);
    canvas.dataset.revision = String(poseSerial);
    canvas.dataset.logoYaw = String(state.yaw);
    canvas.dataset.logoPitch = String(state.pitch);
    canvas.dataset.claimYaw = String(state.yaw);
    canvas.dataset.claimPitch = String(state.pitch);
  };
  const compose = () => {
    if (!backdrop || !active()) return;
    const autoClear = renderer.autoClear;
    renderer.setRenderTarget(null);
    renderer.autoClear = true;
    backdropQuad.render(renderer);
    renderer.autoClear = autoClear;
  };
  const retain = () => {
    renderer.getDrawingBufferSize(bufferSize);
    if (!backdrop || backdrop.image.width !== bufferSize.x || backdrop.image.height !== bufferSize.y) {
      backdrop?.dispose();
      backdrop = new THREE.FramebufferTexture(bufferSize.x, bufferSize.y);
      backdrop.minFilter = backdrop.magFilter = THREE.NearestFilter;
      if (!backdropQuad) backdropQuad = new FullScreenQuad(new THREE.ShaderMaterial({
        uniforms: { map: { value: backdrop } },
        depthTest: false, depthWrite: false,
        // The framebuffer is already premultiplied; blending again darkens edges.
        blending: THREE.NoBlending,
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: `uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = texture2D(map, vUv); }`,
      }));
      backdropQuad.material.uniforms.map.value = backdrop;
    }
    renderer.setRenderTarget(null);
    renderer.copyFramebufferToTexture(copyOrigin, backdrop);
    compose();
  };
  const raster = () => {
    renderer.setRenderTarget(null);
    renderer.render(built.scene.scene, built.scene.camera);
    retain();
  };
  const trace = (steps) => {
    const drawn = tracer.sample(steps);
    if (drawn) retain();
    return drawn;
  };

  const fail = (why) => {
    if (state.phase === "failed") return;
    state.phase = "failed";
    generation++;
    clearTimeout(poseTimer);
    abortDenoise?.();
    diagnostic();
    stop();
    try { options.onFailed?.(why); } catch (e) { /* the caller's problem, not ours */ }
  };
  // Report a clean traced frame for each pose; the first releases the page loader.
  const ready = () => {
    if (state.phase === "ready") return;
    state.phase = "ready";
    diagnostic();
    state.timings.cleanMs = state.timings.cleanMs ?? since();
    try { options.onReady?.({ ...state.timings, tier: state.tier }); } catch (e) { /* ditto */ }
  };
  const progress = () => { diagnostic(); try { options.onProgress?.(state.samples, state.phase); } catch (e) { /* ditto */ } };

  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

  // ---- capability probe -------------------------------------------------

  const webgl2 = () => {
    try {
      const probe = document.createElement("canvas").getContext("webgl2");
      if (!probe) return false;
      probe.getExtension("WEBGL_lose_context")?.loseContext();
      return true;
    } catch (e) { return false; }
  };

  // ---- build ------------------------------------------------------------

  const dims = (cssW, cssH, dpr) => {
    const vh = opt.viewportHeight ?? (globalThis.innerHeight || Math.round(cssW / 2.55));
    const L = layout(cssW, vh, built.script, opt);
    natural = 516 / L.planeBH;
    if (cssH > 0) L.planeBH = Math.max(1, Math.round(516 * cssH / Math.max(1, cssW)));
    L.fxRes = Math.max(L.q.fxRes, Math.min(8, cssW * (dpr || 1) / 516));
    return L;
  };

  const build = async () => {
    const script = await loadScriptFont(opt.scriptFont);
    if (disposed) return;
    built = { script };
    renderer = buildRenderer(canvas);
    const L = dims(box.w, box.h, box.dpr);
    built.L = L;
    generation++;
    built.scene = buildHeroScene(renderer, L, script, opt);
    built.scene.setRenderScale(L.fxRes);
    built.baseZ = built.scene.camera.position.z;
    sway(built.scene.camera, built.baseZ, state.pitch, state.yaw);

    canvas.addEventListener("webglcontextlost", onContextLost, false);

    raster();
    state.timings.firstFrameMs = since();
    state.tier = "webgl-tracer";
    state.phase = "loading";
    progress();
  };

  const onContextLost = (e) => { e.preventDefault?.(); fail("webgl-context-lost"); };

  // ---- the tracer, and then the denoiser --------------------------------

  const attach = async () => {
    const version = generation;
    const source = built.scene;
    const { attachTracer } = await import("./tracer.mjs");
    if (disposed || version !== generation) return;
    const L = built.L;
    source.setFill(0);
    const t = await attachTracer(renderer, source.scene, source.camera, {
      bounces: opt.bounces, tiles: opt.tiles, rtRes: L.q.rtRes, fxRes: L.fxRes,
    });
    if (disposed || version !== generation) { t.dispose(); return; }
    tracer = t;
    source.camera = t.camera;
    sway(source.camera, built.baseZ, state.pitch, state.yaw);
    t.updateCamera();
    state.timings.tracerMs = since();
    state.phase = "tracing";
    progress(); wake();
  };
  const attachOrFail = () => {
    const version = generation;
    return attach().catch((error) => {
      if (disposed || version !== generation) return;
      fail(String(error?.message || error));
    });
  };

  const startDenoiser = async () => {
    const { pickDevice, AuxPass } = await import("./denoiser.mjs");
    const picked = await pickDevice();
    if (!picked || disposed) return;

    backend = picked;
    auxPass = new AuxPass(built.scene.renderer);
    denoiseQuad ||= new FullScreenQuad(blitMaterial());
    wake();
  };

  // The U-Net is built around a tile size that has to fit inside the frame it
  // will be handed, so a frame of another shape needs a net of its own.
  const netFor = async (w, h) => {
    const { loadDenoiser, tileFor } = await import("./denoiser.mjs");
    const tile = tileFor(w, h);
    if (!tile) return null;
    if (unet && unetTile === tile) return unet;

    unet?.dispose?.();
    unet = null;
    const net = await loadDenoiser(backend, tile, opt.weights);
    if (disposed) { net.dispose?.(); return null; }

    unet = net;
    unetTile = tile;
    state.timings.denoiserReadyMs = since();
    return net;
  };

  // The tracer's own image is already on screen and already good, so anything
  // that goes wrong past this point just leaves it there for the session.
  const dropDenoiser = () => {
    unet?.dispose?.();
    unet = null;
    unetTile = 0;
    backend = null;
    state.tier = "webgl-tracer";
  };

  const runDenoise = async () => {
    const serial = poseSerial;
    const { sanitize } = await import("./denoiser.mjs");
    if (!active() || serial !== poseSerial || !tracer || tracer.dead) return;
    const r = built.scene.renderer;
    const target = tracer.target;
    const w = target.width, h = target.height;
    if (!w || !h) return;
    const net = await netFor(w, h);
    if (!net) { dropDenoiser(); return; }
    if (!active() || serial !== poseSerial) return;
    const startedAt = performance.now();

    const color = new Float32Array(w * h * 4);
    r.readRenderTargetPixels(target, 0, 0, w, h, color);
    sanitize(color);
    const { albedo, normal } = auxPass.render(built.scene.scene, built.scene.camera, w, h);

    // An aborted tileExecute never calls done, so the abort has to settle this
    // itself or a resize mid-denoise wedges the loop for good.
    await new Promise((settle) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; settle(); } };
      const abort = net.tileExecute({
        color: { data: color, width: w, height: h },
        albedo: { data: albedo, width: w, height: h },
        normal: { data: normal, width: w, height: h },
        done: (out) => {
          // OIDN overwrites alpha; retain the tracer's antialiased coverage.
          for (let i = 3; i < out.data.length; i += 4) out.data[i] = color[i];
          present(out.data, w, h, serial);
          finish();
        },
      });
      abortDenoise = () => { abort(); finish(); };
    });
    abortDenoise = null;
    state.timings.lastDenoiseMs = Math.round(performance.now() - startedAt);
    state.timings.denoiseSamples = state.samples;
  };

  // A denoised frame that came back empty must never reach the canvas. The
  // tracer's own image is already on screen and already good; a black hero is
  // the one failure this page cannot have, so on a bad frame we drop the
  // denoiser for the session and keep tracing.
  const degenerate = (data) => {
    let sum = 0;
    for (let i = 0; i + 2 < data.length; i += 388) {
      sum += data[i] + data[i + 1] + data[i + 2];
    }
    return !Number.isFinite(sum) || sum < 1e-3;
  };

  const present = (data, w, h, serial) => {
    if (!active() || serial !== poseSerial) return;
    if (degenerate(data)) {
      dropDenoiser();
      return;
    }
    if (!denoiseTex || denoiseTex.image.width !== w || denoiseTex.image.height !== h) {
      denoiseTex?.dispose();
      denoiseTex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
      denoiseTex.minFilter = THREE.NearestFilter;
      denoiseTex.magFilter = THREE.NearestFilter;
    } else {
      denoiseTex.image.data = data;
    }
    denoiseTex.needsUpdate = true;
    denoiseQuad ||= new FullScreenQuad(blitMaterial());
    denoiseQuad.material.uniforms.map.value = denoiseTex;
    const r = built.scene.renderer;
    r.setRenderTarget(null);
    r.clear();
    denoiseQuad.render(r);
    if (!validPicture()) return;
    retain();
    state.tier = "webgpu-denoised";
    posePresented = serial;
    if (!state.timings.denoisedMs) state.timings.denoisedMs = since();
    ready();
  };

  // GL failures can return without throwing; never release the loader to an empty canvas.
  const validPicture = () => {
    const gl = renderer.getContext();
    renderer.getDrawingBufferSize(bufferSize);
    const pixels = new Uint8Array(bufferSize.x * bufferSize.y * 4);
    gl.readPixels(0, 0, bufferSize.x, bufferSize.y, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    if (!gl.isContextLost() && gl.getError() === gl.NO_ERROR) {
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] && (pixels[i] || pixels[i + 1] || pixels[i + 2])) return true;
      }
    }
    fail("empty-traced-frame");
    return false;
  };

  const presentTraced = () => {
    denoiseQuad ||= new FullScreenQuad(blitMaterial());
    denoiseQuad.material.uniforms.map.value = tracer.target.texture;
    renderer.setRenderTarget(null);
    renderer.clear();
    denoiseQuad.render(renderer);
    if (!validPicture()) return;
    retain();
    posePresented = poseSerial;
    state.tier = "webgl-tracer";
    ready();
  };

  // ---- frame ------------------------------------------------------------

  // The archive's vsync-probing governor: learn the display period from the
  // shortest frame interval, ramp steps-per-frame while frames keep hitting
  // vsync, and halve on any miss. Without it a tile a frame takes seconds to
  // reach even a handful of samples.
  let steps = 1, period = 17, prevT = 0, coolUntil = 0, healthyRun = 0;
  const governor = (t) => {
    const dt = prevT ? t - prevT : 8;
    prevT = t;
    period = Math.max(7, Math.min(34, Math.min(period * 1.01, dt)));
    if (dt >= period * 1.45 + 1) {
      steps = Math.max(1, steps >> 1);
      coolUntil = t + 600;
      healthyRun = 0;
    } else if (t > coolUntil && ++healthyRun >= 4) {
      healthyRun = 0;
      steps = Math.min(12, steps + 1);
    }
    return steps;
  };

  const drawTrace = (t) => {
    if (!tracer || performance.now() < poseSettleAt) return;
    if (tracer.dead) { fail("path-tracer-failed"); return; }
    if (tracer.compiling) { wake(); return; }
    state.samples = tracer.samples;
    if (posePresented === poseSerial) { compose(); return; }
    if (denoising) return;
    const wantDenoise = opt.denoise && backend && state.samples >= opt.denoiseAtSamples;
    if (wantDenoise) {
      denoising = true;
      runDenoise().catch(() => dropDenoiser()).finally(() => { denoising = false; wake(); });
      return;
    }
    if (state.samples < opt.cleanSamples) {
      trace(governor(t));
      state.samples = tracer.samples;
      state.phase = "tracing";
      progress();
      wake();
    } else {
      presentTraced();
    }
  };

  function frame(t) {
    raf = 0;
    if (!active() || state.phase === "failed" || !built) return;
    try {
      if (pending) { applyResize(); return; }
      drawTrace(t);
    } catch (e) {
      fail(String(e && e.message || e));
    }
  }

  // ---- resize -----------------------------------------------------------

  const applyResize = () => {
    box = pending;
    pending = null;
    if (!built) return;
    const L = dims(box.w, box.h, box.dpr);
    teardownScene();
    built.L = L;
    built.scene = buildHeroScene(renderer, L, built.script, opt);
    built.scene.setRenderScale(L.fxRes);
    built.baseZ = built.scene.camera.position.z;
    sway(built.scene.camera, built.baseZ, state.pitch, state.yaw);
    raster();
    state.samples = 0;
    state.phase = "loading";
    poseSerial++;
    posePresented = -1;
    progress();
    attachOrFail();
  };

  const teardownScene = () => {
    generation++;
    abortDenoise?.();
    abortDenoise = null;
    tracer?.dispose();
    tracer = null;
    clearTimeout(poseTimer); poseTimer = 0;
    poseSettleAt = 0;
    built.scene.dispose();
    backdrop?.dispose(); backdrop = null;
  };

  // ---- pointer ----------------------------------------------------------

  let dragFrom = null;
  const onDown = (e) => {
    if (e.button !== 0) return;
    dragging = true;
    dragFrom = { x: e.clientX, y: e.clientY, yaw: state.yaw, pitch: state.pitch };
    canvas.style.cursor = "grabbing";
    if (e.pointerType !== "touch") e.preventDefault();
  };
  const onMove = (e) => {
    if (!dragging || !dragFrom) return;
    handle.setDrag(dragFrom.yaw + (e.clientX - dragFrom.x) * 0.005,
      dragFrom.pitch + (e.clientY - dragFrom.y) * 0.005);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    dragFrom = null;
    canvas.style.cursor = "grab";
  };

  // ---- handle -----------------------------------------------------------

  const handle = {
    get state() { return state.phase; },
    get tier() { return state.tier; },
    get samples() { return state.samples; },
    get timings() { return { ...state.timings }; },
    get pose() { return { yaw: state.yaw, pitch: state.pitch }; },
    // What the archive's own layout makes the banner at the current width —
    // the caller sizes its box from this rather than picking a ratio.
    get naturalAspect() { return natural; },

    // Idempotent: a caller wired to a ResizeObserver or a Flutter layout tick
    // will call this every frame, and a rebuild resets the accumulation.
    resize(cssWidth, cssHeight, devicePixelRatio) {
      if (disposed) return;
      const next = {
        w: Math.max(1, cssWidth || 1),
        h: Math.max(1, cssHeight || 1),
        dpr: devicePixelRatio || globalThis.devicePixelRatio || 1,
      };
      const cur = pending || box;
      if (cur && cur.w === next.w && cur.h === next.h && cur.dpr === next.dpr) return;
      pending = next;
      if (!built) box = pending;
      wake();
    },

    // The pose stays exactly where it is put — nothing springs it back.
    setDrag(yawRadians, pitchRadians) {
      if (disposed) return;
      const yaw = clamp(yawRadians, YAW_LIMIT);
      const pitch = clamp(pitchRadians, PITCH_LIMIT);
      if (yaw === state.yaw && pitch === state.pitch) return;
      state.yaw = yaw;
      state.pitch = pitch;
      if (!built?.scene || state.phase === "failed") return;
      sway(built.scene.camera, built.baseZ, pitch, yaw);
      poseSerial++;
      posePresented = -1;
      state.samples = 0;
      state.phase = "settling";
      abortDenoise?.();
      abortDenoise = null;
      tracer?.updateCamera();
      poseSettleAt = performance.now() + POSE_SETTLE_MS;
      clearTimeout(poseTimer);
      poseTimer = setTimeout(() => { poseTimer = 0; wake(); }, POSE_SETTLE_MS);
      built.scene.setFill(0.35);
      raster();
      built.scene.setFill(0);
      diagnostic();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      state.phase = "disposed";
      stop();
      clearTimeout(poseTimer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      abortDenoise?.();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      try {
        if (built?.scene) teardownScene();
        auxPass?.dispose();
        denoiseTex?.dispose();
        denoiseQuad?.dispose();
        unet?.dispose?.();
        backdropQuad?.material.dispose();
        backdropQuad?.dispose();
        renderer?.dispose();
        renderer?.forceContextLoss();
      } catch (e) { /* teardown is best effort */ }
    },
  };

  const visibility = () => {
    if (!active()) { stop(); abortDenoise?.(); return; }
    compose(); wake();
  };
  const pagehide = () => { foreground = false; stop(); abortDenoise?.(); };
  const pageshow = () => { foreground = true; visibility(); };
  const observer = new IntersectionObserver((entries) => {
    visible = entries.at(-1).isIntersecting;
    visibility();
  });
  observer.observe(canvas);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", pagehide);
  window.addEventListener("pageshow", pageshow);

  handle.resize(canvas.clientWidth || canvas.width || 1440,
    canvas.clientHeight || canvas.height || 565,
    globalThis.devicePixelRatio || 1);
  box = pending;
  pending = null;

  if (!webgl2()) {
    queueMicrotask(() => fail("no-webgl2"));
    return handle;
  }

  if (opt.pointerDrag) {
    canvas.style.cursor = "grab";
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  build()
    .then(() => {
      if (disposed) return;
      wake();
      // Both of these are off the first-paint path: the tracer and the denoiser
      // are only imported once there is already a picture on the canvas.
      attachOrFail();
      if (opt.denoise) startDenoiser().catch(() => { /* stays on the tracer rung */ });
    })
    .catch((e) => fail(String(e && e.message || e)));

  return handle;
}

export default createSceneSurface;
