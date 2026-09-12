import * as THREE from '../hero/vendor/three.module.min.js';

export const planetNames = Object.freeze([
  'black and white Earth',
  'Mercury',
  'Venus',
  'realistic Earth',
  'historical Earth',
  'Mars',
  'Jupiter',
  'Saturn',
  'Uranus',
  'Neptune',
  'Moon',
]);

const SIZE = 256;
const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
const hash = (x, y, seed) => {
  let value = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
};

export function planetPixels(name, width = SIZE, height = SIZE) {
  const data = new Uint8Array(width * height * 4);
  const palette = {
    Mercury: [[82, 78, 73], [162, 151, 137]],
    Venus: [[123, 74, 35], [241, 193, 104]],
    Mars: [[104, 38, 24], [218, 102, 54]],
    Jupiter: [[112, 74, 53], [235, 207, 166]],
    Saturn: [[149, 121, 75], [239, 218, 160]],
    Uranus: [[91, 176, 188], [192, 231, 225]],
    Neptune: [[26, 61, 147], [76, 137, 226]],
    Moon: [[63, 62, 59], [189, 188, 179]],
  }[name];
  if (!palette) throw new RangeError(`Unsupported planet: ${name}`);
  const seed = [...name].reduce((sum, character) => sum + character.codePointAt(0), 0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const latitude = y / height;
    const fine = hash(x, y, seed);
    const coarse = hash(Math.floor(x / 9), Math.floor(y / 7), seed * 17);
    let mix = 0.35 * fine + 0.65 * coarse;
    if (['Venus', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'].includes(name)) {
      mix = 0.5 + Math.sin(latitude * Math.PI * (name === 'Jupiter' ? 22 : 14) + coarse * 1.8) * 0.23 + (fine - 0.5) * 0.08;
    }
    if (['Mercury', 'Mars', 'Moon'].includes(name)) {
      const crater = hash(Math.floor(x / 13), Math.floor(y / 13), seed * 31);
      if (crater > 0.82) {
        const cx = (Math.floor(x / 13) + 0.5) * 13, cy = (Math.floor(y / 13) + 0.5) * 13;
        const distance = Math.hypot(x - cx, y - cy) / 6.5;
        if (distance < 1) mix -= (1 - distance) * 0.35;
      }
    }
    let low = palette[0];
    if (name === 'Jupiter') {
      const dx = (x / width - 0.70) / 0.13, dy = (latitude - 0.63) / 0.055;
      if (dx * dx + dy * dy < 1) {
        low = [132, 48, 35];
        mix = 0.3 + fine * 0.25;
      }
    }
    const index = (y * width + x) * 4;
    data[index] = clamp(low[0] + (palette[1][0] - low[0]) * mix);
    data[index + 1] = clamp(low[1] + (palette[1][1] - low[1]) * mix);
    data[index + 2] = clamp(low[2] + (palette[1][2] - low[2]) * mix);
    data[index + 3] = 255;
  }
  return data;
}

export function createPlanetMaterials() {
  const textures = new Set();
  const materials = new Map();
  for (const name of planetNames.filter(value => !value.includes('Earth'))) {
    const texture = new THREE.DataTexture(planetPixels(name), SIZE, SIZE, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    textures.add(texture);
    materials.set(name, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.88, metalness: 0 }));
  }
  return { materials, textures };
}

export function createSaturnRing() {
  const material = new THREE.MeshStandardMaterial({
    color: 0xcdb88a, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    transparent: true, opacity: 0.82,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.72, 96), material);
  ring.name = 'saturn-ring';
  ring.rotation.x = Math.PI / 2.6;
  ring.visible = false;
  return ring;
}
