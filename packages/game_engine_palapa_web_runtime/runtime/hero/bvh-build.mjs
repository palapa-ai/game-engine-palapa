import { Box3, BufferAttribute } from './vendor/three.module.min.js';
import { MeshBVH } from './vendor/three-mesh-bvh.module.js';

export class BvhBuild {
  constructor(worker = new Worker(new URL('./bvh-worker.mjs', import.meta.url), { type: 'module' })) {
    this.worker = worker;
    this.pending = null;
    this.disposed = false;
  }

  generate(geometry, options = {}) {
    if (this.disposed) return Promise.reject(new DOMException('BVH builder disposed', 'AbortError'));
    if (this.pending) return Promise.reject(new Error('BVH worker busy'));
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        this.pending = null;
        this.worker.onmessage = null;
        this.worker.onerror = null;
        if (error) reject(error); else resolve(result);
      };
      this.pending = error => finish(error);
      this.worker.onerror = event => finish(new Error(event.message || 'BVH worker failed'));
      this.worker.onmessage = ({ data }) => {
        if (data.error) { finish(new Error(data.error)); return; }
        if (!data.serialized) return;
        try {
          if (!(data.position instanceof Float32Array) || data.position.length !== geometry.attributes.position.count * 3) {
            throw new TypeError('BVH worker returned invalid positions');
          }
          const bvh = MeshBVH.deserialize(data.serialized, geometry, { setIndex: false });
          geometry.attributes.position.array = data.position;
          if (data.serialized.index) {
            if (geometry.index) geometry.index.array = data.serialized.index;
            else geometry.setIndex(new BufferAttribute(data.serialized.index, 1, false));
          }
          geometry.boundingBox = bvh.getBoundingBox(new Box3());
          finish(null, bvh);
        } catch (error) { finish(error); }
      };
      try {
        const index = geometry.index?.array ?? null;
        const position = geometry.attributes.position.array;
        const buffers = [position.buffer, ...(index ? [index.buffer] : [])];
        this.worker.postMessage(
          { index, position, options: { ...options, onProgress: null, includedProgressCallback: false, groups: [...geometry.groups] } },
          buffers.filter(buffer => typeof SharedArrayBuffer === 'undefined' || !(buffer instanceof SharedArrayBuffer)),
        );
      } catch (error) { finish(error); }
    });
  }

  dispose(reason = new DOMException('BVH build cancelled', 'AbortError')) {
    if (this.disposed) return;
    this.disposed = true;
    this.pending?.(reason);
    this.worker.terminate();
  }
}
