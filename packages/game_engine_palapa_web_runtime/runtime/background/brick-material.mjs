import * as THREE from '../hero/vendor/three.module.min.js';

// These are the hero's original sculpted brick proportions and damp clay mix.
export const BRICK = Object.freeze({ aspect: 2.5, gap: 0.22, depth: 0.5 });
export const BRICK_MATERIALS = Object.freeze([
  { color: 0x3c1a12, roughness: 0.5 }, { color: 0x442016, roughness: 0.55 },
  { color: 0x4c2216, roughness: 0.7 }, { color: 0x552a1a, roughness: 0.75 },
  { color: 0x5e2e1e, roughness: 0.92 }, { color: 0x673522, roughness: 0.88 },
]);
export const MORTAR = 0x0d0d0d;

export function createBrickMaterials(shine) {
  return BRICK_MATERIALS.map(({ color, roughness }) => {
    const material = new THREE.MeshStandardMaterial({ color,
      roughness: roughness * (1 - shine) + 0.02 * shine,
      metalness: shine, flatShading: true });
    material.userData.noReflect = true;
    return material;
  });
}

export function brickProjection(width) {
  return { width, course: Math.max(320, width) * 0.042, x: 0, y: 0 };
}

// Wear is sculpted, not textured: a chip pulls a crater in toward `c`.
const chip = (geo, c, r, depth) => {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - c[0], dy2 = pos.getY(i) - c[1], dz = pos.getZ(i) - c[2];
    const d = Math.hypot(dx, dy2, dz);
    if (d < r) {
      const k = (1 - d / r);
      const kk = k * k * depth;
      pos.setXYZ(i, pos.getX(i) - c[0] * kk, pos.getY(i) - c[1] * kk, pos.getZ(i) - c[2] * kk);
    }
  }
};

export const createBrickGeometry = (w, h, d, wear, random = Math.random) => {
  const g2 = new THREE.BoxGeometry(w, h, d, 5, 3, 2);
  const pos = g2.attributes.position;
  const ph = Array.from({ length: 6 }, () => random() * Math.PI * 2);
  const f1 = (5 + random() * 3) / w, f2 = (13 + random() * 6) / w;
  const a1 = d * 0.045 * (0.6 + wear * 0.7), a2 = d * 0.02 * (0.5 + wear * 0.8);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = a1 * Math.sin(x * f1 + ph[0]) * Math.sin(y * f1 * 1.7 + ph[1])
      + a2 * Math.sin(x * f2 + ph[2]) * Math.sin(y * f2 * 1.4 + ph[3])
      + a2 * 0.7 * Math.sin((x + y) * f2 * 1.9 + ph[4]);
    const ex = Math.max(0, Math.abs(x) / (w / 2) - 0.82) / 0.18;
    const ey = Math.max(0, Math.abs(y) / (h / 2) - 0.7) / 0.3;
    const round = (ex * ex + ey * ey) * d * 0.09;
    pos.setXYZ(i, x - Math.sign(x) * round * 0.5, y - Math.sign(y) * round * 0.5, z + (z > d * 0.33 ? n - round : 0));
  }
  const nch = 1 + Math.floor(random() * 2 + wear * 1.6);
  for (let c2 = 0; c2 < nch; c2++) {
    const onX = random() < 0.5;
    const cx = onX ? (random() < 0.5 ? -1 : 1) * w / 2 : (random() - 0.5) * w * 0.9;
    const cy = onX ? (random() - 0.5) * h * 0.9 : (random() < 0.5 ? -1 : 1) * h / 2;
    chip(g2, [cx, cy, d / 2], (0.14 + random() * 0.22) * h, (0.12 + random() * 0.24) * (0.4 + wear * 0.8));
  }
  if (random() < 0.1 + wear * 0.2) {
    chip(g2, [(random() - 0.5) * w * 0.7, (random() - 0.5) * h * 0.6, d / 2],
      (0.25 + random() * 0.25) * h, 0.08 + random() * 0.12);
  }
  g2.computeVertexNormals();
  return g2;
};
