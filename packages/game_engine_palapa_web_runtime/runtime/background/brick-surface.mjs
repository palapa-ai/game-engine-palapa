import { BRICK, BRICK_MATERIALS, createBrickGeometry } from './brick-material.mjs';
import { visibleBuffer } from './brick-scanlines.mjs';

const TILE_WIDTH = 128, TILE_HEIGHT = 64, VARIANTS = 8;
export const ATLAS_WIDTH = TILE_WIDTH * VARIANTS;
export const ATLAS_HEIGHT = TILE_HEIGHT;

export function cellHash(column, row) {
  let value = (Math.imul(column, 374761393) + Math.imul(row, 668265263) + 7) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}
const seeded = seed => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};
const linear = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const srgb = value => Math.round(255 * Math.max(0, Math.min(1,
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055)));
export const CLAY = BRICK_MATERIALS.map(({ color, roughness }) => ({ roughness,
  rgb: [color >> 16, color >> 8 & 255, color & 255].map(value => linear(value / 255)) }));

let cached = null;
export function brickSurface() {
  if (cached) return cached;
  const pixels = new Float32Array(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = 1;
  const variants = Array.from({ length: VARIANTS }, (_, variant) => {
    const random = seeded(7 + variant * 9817);
    const geometry = createBrickGeometry(BRICK.aspect - BRICK.gap, 1 - BRICK.gap,
      BRICK.depth, 0.35 + variant / VARIANTS * 0.6, random);
    const positions = geometry.attributes.position;
    const indices = geometry.index;
    const triangles = [];
    const depthScale = 0.85 + random() * 0.3;
    for (let i = 0; i < indices.count; i += 3) {
      const points = [0, 1, 2].map(offset => {
        const index = indices.getX(i + offset);
        return [positions.getX(index), positions.getY(index),
          positions.getZ(index) * depthScale + BRICK.depth / 2];
      });
      const [a, b, c] = points;
      const ab = b.map((v, j) => v - a[j]), ac = c.map((v, j) => v - a[j]);
      const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0]];
      const length = Math.hypot(...cross);
      if (length === 0 || cross[2] <= 0) continue;
      const normal = cross.map(v => v / length);
      triangles.push({ points, normal });
      const xy = points.map(([x, y]) => [(x / BRICK.aspect + 0.5) * TILE_WIDTH,
        (y + 0.5) * TILE_HEIGHT]);
      const [p, q, r] = xy;
      const denominator = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
      if (Math.abs(denominator) < 1e-8) continue;
      const minX = Math.max(0, Math.floor(Math.min(...xy.map(p => p[0]))));
      const maxX = Math.min(TILE_WIDTH - 1, Math.ceil(Math.max(...xy.map(p => p[0]))));
      const minY = Math.max(0, Math.floor(Math.min(...xy.map(p => p[1]))));
      const maxY = Math.min(TILE_HEIGHT - 1, Math.ceil(Math.max(...xy.map(p => p[1]))));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const wa = ((q[1] - r[1]) * (x + 0.5 - r[0]) + (r[0] - q[0]) * (y + 0.5 - r[1])) / denominator;
        const wb = ((r[1] - p[1]) * (x + 0.5 - r[0]) + (p[0] - r[0]) * (y + 0.5 - r[1])) / denominator;
        const wc = 1 - wa - wb;
        if (Math.min(wa, wb, wc) < -1e-6) continue;
        const z = wa * a[2] + wb * b[2] + wc * c[2];
        const index = (y * ATLAS_WIDTH + variant * TILE_WIDTH + x) * 4;
        if (z <= pixels[index]) continue;
        pixels.set([z, ...normal], index);
      }
    }
    geometry.dispose();
    return triangles.sort((a, b) => a.points.reduce((s, p) => s + p[2], 0) -
      b.points.reduce((s, p) => s + p[2], 0));
  });
  cached = { pixels, variants };
  return cached;
}

// Immediate raster uses the same sculpted faces as the traced height field.
export function paintBricks(canvas, width, height, projection) {
  const buffer = visibleBuffer(width, height);
  canvas.width = buffer.width; canvas.height = buffer.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(buffer.width / width, buffer.height / height);
  const mortar = ctx.createLinearGradient(0, 0, width, 0);
  mortar.addColorStop(0, '#121110'); mortar.addColorStop(0.5, '#1c1b1a'); mortar.addColorStop(1, '#121110');
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, width, height);
  const { variants } = brickSurface();
  const { course, x: originX, y: originY } = projection;
  const brickWidth = course * BRICK.aspect;
  for (let row = Math.floor((originY - height) / course); row <= Math.floor(originY / course); row++) {
    const shift = ((row % 2 + 2) % 2) * brickWidth / 2;
    for (let column = Math.floor((-originX - shift) / brickWidth);
      column <= Math.floor((width - originX - shift) / brickWidth); column++) {
      const hash = cellHash(column, row);
      if (hash % 1000 < 15) continue;
      const material = CLAY[(hash >>> 8) % CLAY.length];
      const cx = originX + (column + 0.5) * brickWidth + shift;
      const cy = originY - (row + 0.5) * course;
      const wash = 0.78 + 0.22 * Math.exp(-(((cx / width - 0.5) * 2) ** 2));
      variants[hash % VARIANTS].forEach(({ points, normal }) => {
        const diffuse = Math.max(0, normal[0] * -0.31 + normal[1] * 0.47 + normal[2] * 0.826);
        const light = (0.2 + diffuse * 1.65 * wash) * 0.38;
        const halfDot = Math.max(0, normal[0] * -0.162 + normal[1] * 0.246 + normal[2] * 0.956);
        const specular = 0.022 * halfDot ** (4 + (1 - material.roughness) * 18);
        const rgb = material.rgb.map((v, channel) => srgb(v * light * [1, 0.88, 0.76][channel]
          + specular * [0.69, 0.78, 1][channel]));
        ctx.fillStyle = `rgb(${rgb.join(',')})`;
        ctx.beginPath();
        points.forEach(([x, y], index) => {
          if (index === 0) ctx.moveTo(cx + x * course, cy - y * course);
          else ctx.lineTo(cx + x * course, cy - y * course);
        });
        ctx.closePath(); ctx.fill();
      });
    }
  }
}
