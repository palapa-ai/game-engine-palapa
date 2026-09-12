import * as THREE from "./vendor/three.module.min.js";
import { MeshBVH } from "./vendor/three-mesh-bvh.module.js";

const MAX_VERTICES = 360000;
const MAX_TRIANGLES = 120000;
const MAX_SURFACE_SAMPLES = 65000;
const SAMPLES_PER_TURN = 64;
const SKY_RAYS = 4;
const LIGHT_RAYS = 2;
const LIGHT_RADIUS = 0.05;
const MAX_TRANSMISSIONS = 8;
const INV_PI = 1 / Math.PI;
let current = null;

const free = () => {
  if (!current) return;
  clearTimeout(current.timer);
  current.geometry.dispose();
  current = null;
};
const flush = (job, type) => {
  const updates = [...job.dirty].map((mesh) => ({ mesh, colors: job.meshes[mesh].colors.slice() }));
  job.dirty.clear();
  postMessage({
    type, id: job.id, updates, cursor: job.cursor, bands: job.bands,
    rays: job.rays,
  }, updates.map(({ colors }) => colors.buffer));
};
const fail = (id) => {
  free();
  postMessage({ type: "error", id, error: "invalid-lighting-scene" });
};
const basis = (direction) => {
  const axis = Math.abs(direction.z) < 0.9
    ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const tangent = axis.cross(direction).normalize();
  return [tangent, direction.clone().cross(tangent)];
};
const noise = (seed) => {
  let value = seed | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};
const estimate = (normal, ambient, lights) => {
  const value = ambient.map((v) => v * INV_PI);
  for (const light of lights) {
    const cosine = Math.max(0, normal.dot(light.direction));
    for (let channel = 0; channel < 3; channel++) value[channel] += light.color[channel] * cosine * INV_PI;
  }
  return value;
};

function prepare(data) {
  if (!Number.isFinite(data.height) || !(data.height > 0) || data.height > 100000 ||
    !(data.bandHeight > 0) || !data.meshes?.length || data.meshes.length > 4096 ||
    data.lights?.length > 8) throw new Error("scene-budget");
  let vertices = 0;
  let triangles = 0;
  for (const mesh of data.meshes) {
    if (!mesh.positions?.length || mesh.positions.length % 3 ||
      mesh.normals?.length !== mesh.positions.length ||
      mesh.colors && mesh.colors.length !== mesh.positions.length ||
      mesh.matrix?.length !== 16 || mesh.color?.length !== 3 ||
      ![...mesh.matrix, ...mesh.color, mesh.opacity].every(Number.isFinite)) throw new Error("mesh");
    vertices += mesh.positions.length / 3;
    triangles += (mesh.indices?.length || mesh.positions.length / 3) / 3;
  }
  if (vertices > MAX_VERTICES || triangles > MAX_TRIANGLES || !Number.isInteger(triangles)) throw new Error("geometry-budget");
  const positions = new Float32Array(vertices * 3);
  const owners = new Uint16Array(vertices);
  const indices = new Uint32Array(triangles * 3);
  const geometry = new THREE.BufferGeometry();
  const projection = new THREE.Matrix4().fromArray(data.projection);
  const eye = new THREE.Vector3().fromArray(data.eye);
  const lights = data.lights.map((light) => {
    const direction = new THREE.Vector3().fromArray(light.direction).normalize();
    return { direction, color: light.color, basis: basis(direction) };
  });
  let offset = 0;
  let indexOffset = 0;
  const samples = [];
  const meshes = [];
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const view = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const totalBands = Math.ceil(data.height / data.bandHeight);
  for (const [meshIndex, mesh] of data.meshes.entries()) {
    const matrix = new THREE.Matrix4().fromArray(mesh.matrix);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const count = mesh.positions.length / 3;
    const colors = mesh.colors || new Float32Array(mesh.positions.length);
    const unique = new Map();
    for (let vertex = 0; vertex < count; vertex++) {
      point.fromArray(mesh.positions, vertex * 3).applyMatrix4(matrix);
      normal.fromArray(mesh.normals, vertex * 3).applyNormalMatrix(normalMatrix);
      if (![point.x, point.y, point.z, normal.x, normal.y, normal.z].every(Number.isFinite)) throw new Error("coordinates");
      point.toArray(positions, (offset + vertex) * 3);
      owners[offset + vertex] = meshIndex;
      bounds.expandByPoint(point);
      if (!mesh.colors) {
        const initial = estimate(normal, data.ambient, lights);
        for (let channel = 0; channel < 3; channel++) colors[vertex * 3 + channel] = initial[channel] * mesh.color[channel];
      }
      if (normal.dot(view.copy(eye).sub(point)) <= 0) continue;
      const key = `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)},${normal.x.toFixed(4)},${normal.y.toFixed(4)},${normal.z.toFixed(4)}`;
      let sample = unique.get(key);
      if (!sample) {
        projected.copy(point).applyMatrix4(projection);
        const y = (1 - projected.y) * data.height / 2;
        const band = Math.max(0, Math.min(totalBands - 1, Math.floor(y / data.bandHeight)));
        sample = { point: point.clone(), normal: normal.clone(), mesh: meshIndex, vertices: [], band };
        unique.set(key, sample);
        samples.push(sample);
        if (samples.length > MAX_SURFACE_SAMPLES) throw new Error("surface-budget");
      }
      sample.vertices.push(vertex);
    }
    const meshIndices = mesh.indices;
    for (let index = 0; index < (meshIndices?.length || count); index++) {
      const local = meshIndices ? meshIndices[index] : index;
      if (!Number.isInteger(local) || local < 0 || local >= count) throw new Error("indices");
      indices[indexOffset++] = offset + local;
    }
    meshes.push({ colors, color: mesh.color, opacity: Math.max(0, Math.min(1, mesh.opacity)) });
    offset += count;
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const bvh = new MeshBVH(geometry, { maxLeafTris: 8 });
  samples.sort((a, b) => a.band - b.band);
  if (!Number.isInteger(data.cursor) || data.cursor < 0 || data.cursor > samples.length) throw new Error("cursor");
  const diagonal = bounds.getSize(new THREE.Vector3()).length();
  return {
    id: data.id, geometry, bvh, owners, meshes, samples, lights, ambient: data.ambient,
    epsilon: Math.max(1e-6, diagonal * 1e-6), far: Math.max(1, diagonal * 2),
    cursor: data.cursor, bands: data.bands, totalBands, rays: data.rays,
    dirty: new Set(), ray: new THREE.Ray(), direction: new THREE.Vector3(),
    timer: null, background: !!data.background,
  };
}

function transmission(job, origin, direction) {
  job.rays++;
  job.ray.origin.copy(origin);
  job.ray.direction.copy(direction);
  let near = job.epsilon;
  let amount = 1;
  const crossed = new Set();
  for (let index = 0; index < MAX_TRANSMISSIONS; index++) {
    const hit = job.bvh.raycastFirst(job.ray, THREE.DoubleSide, near, job.far);
    if (!hit) return amount;
    const owner = job.owners[hit.face.a];
    const opacity = job.meshes[owner].opacity;
    if (opacity >= 1) return 0;
    if (!crossed.has(owner)) { amount *= 1 - opacity; crossed.add(owner); }
    if (amount < 0.001) return 0;
    near = hit.distance + job.epsilon;
  }
  return 0;
}
function bake(job, sample, index) {
  const { normal, point } = sample;
  const origin = point.clone().addScaledVector(normal, job.epsilon * 4);
  const [tangent, bitangent] = basis(normal);
  const phase = noise(index + 1) * Math.PI * 2;
  let sky = 0;
  for (let ray = 0; ray < SKY_RAYS; ray++) {
    const radius = Math.sqrt((ray + 0.5) / SKY_RAYS);
    const angle = phase + ray * 2.399963229728653;
    job.direction.copy(normal).multiplyScalar(Math.sqrt(1 - radius * radius))
      .addScaledVector(tangent, radius * Math.cos(angle))
      .addScaledVector(bitangent, radius * Math.sin(angle)).normalize();
    sky += transmission(job, origin, job.direction) / SKY_RAYS;
  }
  const irradiance = job.ambient.map((v) => v * sky * INV_PI);
  for (const light of job.lights) {
    let amount = 0;
    for (let ray = 0; ray < LIGHT_RAYS; ray++) {
      const angle = phase + ray * Math.PI;
      job.direction.copy(light.direction)
        .addScaledVector(light.basis[0], LIGHT_RADIUS * Math.cos(angle))
        .addScaledVector(light.basis[1], LIGHT_RADIUS * Math.sin(angle)).normalize();
      const cosine = Math.max(0, normal.dot(job.direction));
      if (cosine > 0) amount += cosine * transmission(job, origin, job.direction) / LIGHT_RAYS;
    }
    for (let channel = 0; channel < 3; channel++) irradiance[channel] += light.color[channel] * amount * INV_PI;
  }
  const mesh = job.meshes[sample.mesh];
  for (const vertex of sample.vertices) {
    for (let channel = 0; channel < 3; channel++) mesh.colors[vertex * 3 + channel] = irradiance[channel] * mesh.color[channel];
  }
  job.dirty.add(sample.mesh);
}
function step() {
  const job = current;
  if (!job) return;
  try {
    const end = Math.min(job.samples.length, job.cursor + SAMPLES_PER_TURN);
    while (job.cursor < end) {
      const sample = job.samples[job.cursor];
      bake(job, sample, job.cursor);
      job.cursor++;
      const nextBand = job.samples[job.cursor]?.band ?? job.totalBands;
      if (nextBand > sample.band) {
        job.bands = nextBand;
        if (job.cursor < job.samples.length) flush(job, "progress");
      }
    }
    if (job.cursor === job.samples.length) {
      job.bands = job.totalBands;
      flush(job, "complete");
      free();
    } else job.timer = setTimeout(step, job.background ? 50 : 0);
  } catch (_) { fail(job.id); }
}

self.onmessage = ({ data }) => {
  if (data.type === "start") {
    free();
    try {
      current = prepare(data);
      postMessage({ type: "ready", id: current.id, totalBands: current.totalBands });
      current.timer = setTimeout(step, 0);
    } catch (_) { fail(data.id); }
  } else if (current?.id === data.id) {
    if (data.type === "priority") current.background = !!data.background;
    if (data.type === "pause") flush(current, "paused");
    if (data.type === "pause" || data.type === "cancel") free();
  }
};
