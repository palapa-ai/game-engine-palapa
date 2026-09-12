// Intel Open Image Denoise (oidn-web, WGSL/WebGPU) over the WebGL path tracer.
//
// The tracer and the denoiser cannot share memory: one is a WebGL2 context, the
// other a WebGPU device, and cross-origin isolation is not available on the
// site, so the SharedArrayBuffer/threads path is out. Everything therefore goes
// through the CPU — one float readback of the accumulation buffer, two byte
// readbacks for the auxiliary buffers, one upload of the result.
//
// three-gpu-pathtracer 0.0.23 has no albedo/normal AOV of its own (checked:
// nothing in src/ writes one), so the auxiliaries are rastered from the same
// scene and camera at the tracer's own resolution — which is exactly what OIDN
// wants, since both are primary-hit quantities.
import * as THREE from "./vendor/three.module.min.js";

export const WEIGHTS = "./vendor/weights/rt_hdr_alb_nrm_small.tza";

let libP = null;
const lib = () => libP || (libP = import("./vendor/oidn.module.js"));

// A WebGPU device we can actually run on, or null. Never throws.
export async function pickDevice() {
  try {
    if (!globalThis.navigator || !navigator.gpu || !globalThis.isSecureContext) return null;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    const requiredFeatures = adapter.features.has("shader-f16") ? ["shader-f16"] : [];
    const device = await adapter.requestDevice({ requiredFeatures });
    if (!device) return null;
    return { device, adapterInfo: adapter.info || {} };
  } catch (e) {
    return null;
  }
}

// oidn-web reads tileSize + 2 x overlap pixels per tile straight out of the
// frame with no clamp at its edges, so a frame whose short side is smaller than
// that runs off the end of its own buffer; the undefineds come back as NaN, and
// the per-tile autoexposure then spreads them over the whole image. The overlap
// is half the small U-Net's receptive field, rounded up to the tile grid, and
// 512 is the library's own ceiling.
const TILE_GRID = 16;
const TILE_OVERLAP = 96;
const TILE_MAX = 512;

// The largest tile oidn-web can read out of a frame this size, or null if even
// the smallest one would not fit.
export const tileFor = (width, height) => {
  const fits = Math.floor((Math.min(width, height) - 2 * TILE_OVERLAP) / TILE_GRID) * TILE_GRID;
  return fits < TILE_GRID ? null : Math.min(TILE_MAX, fits);
};

export async function loadDenoiser(backend, tile, weightsUrl = WEIGHTS) {
  const { initUNetFromURL } = await lib();
  const url = new URL(weightsUrl, import.meta.url).href;
  return initUNetFromURL(url, backend, { aux: true, hdr: true, maxTileSize: tile });
}

// Renders the albedo and the view-space normal of the primary hit, at the
// tracer's resolution, into byte targets oidn-web reads as [0,1].
export class AuxPass {
  constructor(renderer) {
    this.renderer = renderer;
    this.albedoTarget = null;
    this.normalTarget = null;
    this.normalMaterial = new THREE.MeshNormalMaterial();
    this.albedoMaterials = new WeakMap();
    this.width = 0;
    this.height = 0;
  }

  _resize(w, h) {
    if (this.width === w && this.height === h) return;
    this.albedoTarget?.dispose();
    this.normalTarget?.dispose();
    const opts = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true };
    this.albedoTarget = new THREE.WebGLRenderTarget(w, h, opts);
    this.normalTarget = new THREE.WebGLRenderTarget(w, h, opts);
    this.width = w;
    this.height = h;
  }

  _albedoOf(m) {
    const hit = this.albedoMaterials.get(m);
    if (hit) return hit;
    const flat = new THREE.MeshBasicMaterial({ color: m.color ? m.color.clone() : 0xffffff, side: m.side, transparent: false });
    this.albedoMaterials.set(m, flat);
    return flat;
  }

  render(scene, camera, w, h) {
    const r = this.renderer;
    this._resize(w, h);
    const previousTarget = r.getRenderTarget();

    const swapped = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      swapped.push([o, o.material]);
      o.material = Array.isArray(o.material) ? o.material.map((m) => this._albedoOf(m)) : this._albedoOf(o.material);
    });
    r.setRenderTarget(this.albedoTarget);
    r.render(scene, camera);
    swapped.forEach(([o, m]) => { o.material = m; });

    scene.overrideMaterial = this.normalMaterial;
    r.setRenderTarget(this.normalTarget);
    r.render(scene, camera);
    scene.overrideMaterial = null;

    const albedo = new Uint8Array(w * h * 4);
    const normal = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(this.albedoTarget, 0, 0, w, h, albedo);
    r.readRenderTargetPixels(this.normalTarget, 0, 0, w, h, normal);
    r.setRenderTarget(previousTarget);
    return { albedo, normal };
  }

  dispose() {
    this.albedoTarget?.dispose();
    this.normalTarget?.dispose();
    this.normalMaterial.dispose();
  }
}

// Fireflies and escaped rays leave Inf/NaN in the accumulation buffer, and the
// U-Net's PU encode turns one of those into a whole black tile.
const SANE_MAX = 65504;
export function sanitize(color) {
  for (let i = 0; i < color.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = color[i + c];
      color[i + c] = Number.isFinite(v) ? Math.min(Math.max(v, 0), SANE_MAX) : 0;
    }
    const alpha = color[i + 3];
    color[i + 3] = Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 0;
    if (color[i + 3] === 0) color[i] = color[i + 1] = color[i + 2] = 0;
  }
  return color;
}
