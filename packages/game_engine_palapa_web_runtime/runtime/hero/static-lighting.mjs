import * as THREE from "./vendor/three.module.min.js";

const MAX_VERTICES = 360000;
const MAX_TRIANGLES = 120000;
const BAND_HEIGHT = 32;
const WORKER_TIMEOUT = 15000;
const clients = new Set();
let worker = null;
let active = null;
let serial = 0;
let scheduled = null;
let watchdog = null;
let foreground = true;

const visible = (canvas) => {
  const bounds = canvas.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 &&
    bounds.right > 0 && bounds.top < innerHeight && bounds.left < innerWidth;
};
const canRun = (client) => !client.disposed && !client.done && !client.failed &&
  client.visible && !document.hidden && foreground;
const stopWatchdog = () => { clearTimeout(watchdog); watchdog = null; };
const shutdown = () => {
  stopWatchdog();
  worker?.terminate();
  worker = null;
  active = null;
};
const error = (why) => {
  const client = active;
  shutdown();
  if (client && !client.disposed) {
    client.failed = true;
    client.canvas.dataset.render = "fallback";
    client.canvas.dataset.traceFailure = why;
  }
  schedule();
};
const watch = () => {
  stopWatchdog();
  watchdog = setTimeout(() => error("worker-timeout"), WORKER_TIMEOUT);
};
const apply = (client, data) => {
  (data.updates || []).forEach(({ mesh: index, colors }) => {
    const entry = client.meshes[index];
    if (!entry || colors.length !== entry.mesh.geometry.attributes.position.count * 3) {
      throw new Error("invalid-lighting-result");
    }
    const geometry = entry.mesh.geometry;
    const current = geometry.getAttribute("color");
    if (entry.lit && current?.array.length === colors.length) {
      current.array.set(colors);
      current.needsUpdate = true;
    } else {
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const original = entry.mesh.material;
      entry.mesh.material = new THREE.MeshBasicMaterial({
        color: 0xffffff, vertexColors: true, side: original.side,
        transparent: original.transparent, opacity: original.opacity,
        depthWrite: original.depthWrite, toneMapped: original.toneMapped,
      });
      original.dispose();
      entry.lit = true;
    }
  });
  client.cursor = data.cursor ?? client.cursor;
  client.bands = data.bands ?? client.bands;
  client.rays = data.rays ?? client.rays;
  client.canvas.dataset.traceBands = String(client.bands);
  client.canvas.dataset.traceRays = String(client.rays);
  if (data.updates?.length) {
    client.dirty = true;
    if (client.visible && !document.hidden && foreground) {
      client.render();
      client.dirty = false;
    }
  }
};
const connect = () => {
  if (worker) return;
  worker = new Worker(new URL("./static-lighting-worker.mjs", import.meta.url), { type: "module" });
  const connection = worker;
  worker.onerror = (event) => {
    event.preventDefault();
    if (worker === connection) error("worker-unavailable");
  };
  worker.onmessage = ({ data }) => {
    if (worker !== connection) return;
    const client = active;
    if (!client || client.disposed || data.id !== client.id) return;
    watch();
    if (data.type === "error") return error(data.error || "lighting-failed");
    try {
      if (data.type === "ready") {
        client.canvas.dataset.render = "tracing";
        client.canvas.dataset.traceTotalBands = String(data.totalBands);
      } else if (data.type === "progress" || data.type === "paused" || data.type === "complete") {
        apply(client, data);
      }
      if (data.type === "complete") {
        client.done = true;
        client.canvas.dataset.render = "complete";
      }
      if (data.type === "complete" || data.type === "paused") {
        stopWatchdog();
        active = null;
        client.pausing = false;
        schedule();
      }
    } catch (_) { error("lighting-result-failed"); }
  };
};
const payload = (client) => {
  client.scene.updateMatrixWorld(true);
  client.camera.updateMatrixWorld(true);
  const transfer = [];
  const copy = (array) => {
    const result = array.slice();
    transfer.push(result.buffer);
    return result;
  };
  const meshes = client.meshes.map(({ mesh, color, lit }) => ({
    positions: copy(mesh.geometry.attributes.position.array),
    normals: copy(mesh.geometry.attributes.normal.array),
    indices: mesh.geometry.index ? copy(mesh.geometry.index.array) : null,
    matrix: mesh.matrixWorld.toArray(), color, opacity: mesh.material.opacity,
    colors: lit ? copy(mesh.geometry.attributes.color.array) : null,
  }));
  const ambient = [0, 0, 0];
  const lights = [];
  client.scene.traverse((object) => {
    if (object.isAmbientLight) {
      ambient[0] += object.color.r * object.intensity;
      ambient[1] += object.color.g * object.intensity;
      ambient[2] += object.color.b * object.intensity;
    } else if (object.isDirectionalLight) {
      const direction = object.getWorldPosition(new THREE.Vector3())
        .sub(object.target.getWorldPosition(new THREE.Vector3())).normalize();
      lights.push({ direction: direction.toArray(), color: object.color.toArray().map((v) => v * object.intensity) });
    }
  });
  const projection = new THREE.Matrix4().multiplyMatrices(client.camera.projectionMatrix, client.camera.matrixWorldInverse);
  return [{
    type: "start", id: client.id, meshes, ambient, lights,
    projection: projection.toArray(), eye: client.camera.getWorldPosition(new THREE.Vector3()).toArray(),
    height: client.height, bandHeight: BAND_HEIGHT, cursor: client.cursor,
    rays: client.rays, bands: client.bands,
  }, transfer];
};
const pump = () => {
  scheduled = null;
  if (active) {
    if (!canRun(active) && !active.pausing) {
      active.pausing = true;
      worker?.postMessage({ type: "pause", id: active.id });
      watch();
    }
    return;
  }
  const next = [...clients].filter(canRun)
    .sort((a, b) => a.canvas.getBoundingClientRect().top - b.canvas.getBoundingClientRect().top)[0];
  if (!next) { shutdown(); return; }
  active = next;
  try {
    connect();
    const [data, transfer] = payload(next);
    worker.postMessage(data, transfer);
    watch();
  } catch (_) { error("lighting-unavailable"); }
};
function schedule() {
  if (scheduled === null) scheduled = setTimeout(pump, 0);
}
const visibility = () => {
  clients.forEach((client) => {
    if (!client.observer) client.visible = visible(client.canvas);
    client.canvas.dataset.tracePaused = String(!foreground || document.hidden || !client.visible);
    if (client.dirty && client.visible && !document.hidden && foreground) {
      try { client.render(); client.dirty = false; } catch (_) { client.failed = true; client.canvas.dataset.render = "fallback"; }
    }
  });
  schedule();
};

const pageHidden = () => { foreground = false; visibility(); };
const pageShown = () => { foreground = true; visibility(); };

export function traceStaticLighting(canvas, scene, camera, height, revision, render) {
  const meshes = [];
  let vertices = 0;
  let triangles = 0;
  scene.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.visible) return;
    const positions = mesh.geometry.attributes.position;
    if (positions?.count === 0) return;
    const normals = mesh.geometry.attributes.normal;
    if (!positions || !normals || positions.itemSize !== 3 || normals.itemSize !== 3 ||
      positions.isInterleavedBufferAttribute || normals.isInterleavedBufferAttribute ||
      Array.isArray(mesh.material)) throw new Error("unsupported-lighting-geometry");
    vertices += positions.count;
    triangles += (mesh.geometry.index?.count || positions.count) / 3;
    meshes.push({ mesh, color: mesh.material.color.toArray(), lit: false });
  });
  canvas.dataset.render = "raster";
  canvas.dataset.traceRevision = revision;
  canvas.dataset.traceMethod = "geometry-ray-lighting";
  canvas.dataset.traceBands = "0";
  canvas.dataset.traceTotalBands = String(Math.ceil(height / BAND_HEIGHT));
  canvas.dataset.traceRays = "0";
  delete canvas.dataset.traceFailure;
  if (!meshes.length || vertices > MAX_VERTICES || triangles > MAX_TRIANGLES || !(height > 0) || !Number.isFinite(height)) {
    canvas.dataset.render = "fallback";
    canvas.dataset.traceFailure = "geometry-budget";
    return { dispose() {} };
  }
  const client = {
    id: ++serial, canvas, scene, camera, height, render, meshes,
    visible: visible(canvas), cursor: 0, rays: 0, bands: 0,
    disposed: false, failed: false, done: false, dirty: false, pausing: false,
  };
  clients.add(client);
  if (clients.size === 1) {
    foreground = !document.hidden;
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pageHidden);
    window.addEventListener("pageshow", pageShown);
    window.addEventListener("scroll", visibility, { passive: true });
  }
  let observer = null;
  try {
    if (typeof IntersectionObserver !== "undefined") observer = new IntersectionObserver(([entry]) => {
      if (client.disposed) return;
      client.visible = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0;
      visibility();
    });
    observer?.observe(canvas);
  } catch (_) { observer?.disconnect(); observer = null; }
  client.observer = observer;
  canvas.dataset.tracePaused = String(!foreground || document.hidden || !client.visible);
  schedule();
  return {
    dispose() {
      if (client.disposed) return;
      client.disposed = true;
      observer?.disconnect();
      clients.delete(client);
      if (active === client) {
        worker?.postMessage({ type: "cancel", id: client.id });
        stopWatchdog();
        active = null;
      }
      if (!clients.size) {
        clearTimeout(scheduled);
        scheduled = null;
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("pagehide", pageHidden);
        window.removeEventListener("pageshow", pageShown);
        window.removeEventListener("scroll", visibility);
        shutdown();
      } else schedule();
    },
  };
}
