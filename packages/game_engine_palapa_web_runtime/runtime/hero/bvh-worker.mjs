// The path tracer's BVH is built here, off the main thread, and handed back
// serialised. Same wire protocol as three-mesh-bvh's own generateMeshBVH.worker.js.
import { BufferGeometry, BufferAttribute } from "./vendor/three.module.min.js";
import { MeshBVH } from "./vendor/three-mesh-bvh.module.js";

onmessage = ({ data }) => {
  const { index, position, options } = data;
  try {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(position, 3, false));
    if (index) geometry.setIndex(new BufferAttribute(index, 1, false));
    (options.groups || []).forEach((g) => geometry.addGroup(g.start, g.count, g.materialIndex));
    const bvh = new MeshBVH(geometry, { ...options, onProgress: null });
    const serialized = MeshBVH.serialize(bvh, { copyIndexBuffer: false });
    const transfer = [position.buffer, ...serialized.roots];
    if (serialized.index) transfer.push(serialized.index.buffer);
    if (serialized.indirectBuffer) transfer.push(serialized.indirectBuffer.buffer);
    postMessage({ error: null, serialized, position },
      transfer.filter((b) => typeof SharedArrayBuffer === "undefined" || !(b instanceof SharedArrayBuffer)));
  } catch (error) {
    postMessage({ error: String((error && error.message) || error), serialized: null, position: null });
  }
};
