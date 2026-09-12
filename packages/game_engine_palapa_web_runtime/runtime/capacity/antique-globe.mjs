import * as THREE from '../hero/vendor/three.module.min.js';

export function antiqueMap(rings) {
  const canvas = document.createElement('canvas');
  canvas.width = 1536; canvas.height = 768;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const paper = ctx.createLinearGradient(0, 0, w, h);
  paper.addColorStop(0, '#c5aa74');
  paper.addColorStop(0.45, '#e7d8af');
  paper.addColorStop(1, '#baa071');
  ctx.fillStyle = paper; ctx.fillRect(0, 0, w, h);
  let seed = 7419;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 38000; i++) {
    ctx.fillStyle = `rgba(74,48,24,${random() * 0.085})`;
    ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1);
  }
  rings.forEach((ring, index) => {
    const points = [];
    for (let i = 0; i < ring.length; i += 2) {
      let x = (ring[i] + 180) / 360 * w;
      const previous = points.at(-1)?.[0];
      if (previous !== undefined) {
        while (x - previous > w / 2) x -= w;
        while (x - previous < -w / 2) x += w;
      }
      points.push([x, (90 - ring[i + 1]) / 180 * h]);
    }
    ctx.fillStyle = ['#c1b78d', '#c8af8f', '#b2b697', '#cfbca0'][index % 4];
    ctx.strokeStyle = '#786345'; ctx.lineWidth = 1.1;
    for (const offset of [-w, 0, w]) {
      ctx.beginPath();
      points.forEach(([x, y], i) => i ? ctx.lineTo(x + offset, y) : ctx.moveTo(x + offset, y));
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  });
  ctx.strokeStyle = 'rgba(84,63,35,.35)'; ctx.lineWidth = 0.8;
  for (let lon = -180; lon <= 180; lon += 15) {
    const x = (lon + 180) / 360 * w;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const y = (90 - lat) / 180 * h;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#625238';
  const labels = [['NORTH AMERICA', -108, 46], ['SOUTH AMERICA', -59, -18],
    ['AFRICA', 21, 5], ['EUROPE', 19, 53], ['ASIA', 89, 40], ['AUSTRALIA', 135, -25],
    ['ATLANTIC OCEAN', -34, 12], ['PACIFIC OCEAN', -145, -8], ['INDIAN OCEAN', 79, -22]];
  labels.forEach(([name, lon, lat]) => {
    ctx.font = name.includes('OCEAN') ? 'italic 14px Georgia, serif' : '15px Georgia, serif';
    ctx.fillText(name, (lon + 180) / 360 * w, (90 - lat) / 180 * h);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function antiqueMount() {
  const group = new THREE.Group();
  group.name = 'antique-globe-meridian';
  const frame = new THREE.Group();
  frame.rotation.x = 0.42;
  group.add(frame);
  const brass = new THREE.MeshStandardMaterial({ color: 0xbda56a, metalness: 0.78, roughness: 0.27 });
  const meridian = new THREE.Mesh(new THREE.TorusGeometry(1.04, 0.018, 8, 128), brass);
  meridian.rotation.y = 0.95;
  frame.add(meridian);
  for (const sign of [-1, 1]) {
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 0.16, 12), brass);
    spindle.position.y = sign * 1.055; frame.add(spindle);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.031, 12, 8), brass);
    cap.position.y = sign * 1.13; frame.add(cap);
  }
  const size = 128, grain = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const wave = Math.sin(x * 0.8 + Math.sin(y * 0.07) * 2.4);
    const fine = Math.sin(x * 3.1 + y * 0.11) * 0.08;
    const tone = 0.76 + wave * 0.16 + fine;
    grain.set([105 * tone, 56 * tone, 28 * tone, 255], (y * size + x) * 4);
  }
  const woodMap = new THREE.DataTexture(grain, size, size);
  woodMap.colorSpace = THREE.SRGBColorSpace;
  woodMap.wrapS = woodMap.wrapT = THREE.RepeatWrapping;
  woodMap.needsUpdate = true;
  const wood = new THREE.MeshPhysicalMaterial({ map: woodMap, roughness: 0.4, metalness: 0,
    clearcoat: 0.3, clearcoatRoughness: 0.3 });
  wood.addEventListener('dispose', () => woodMap.dispose());
  const profile = [[0, -1.34], [.48, -1.34], [.54, -1.31], [.54, -1.26],
    [.49, -1.22], [.26, -1.21], [.15, -1.16], [0, -1.16]];
  const pedestal = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 64), wood);
  pedestal.name = 'antique-globe-wooden-base';
  pedestal.castShadow = pedestal.receiveShadow = true;
  group.add(pedestal);
  const support = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, -1.03, -0.46), new THREE.Vector3(0, -1.18, -0.46), new THREE.Vector3(0, -1.17, 0));
  group.add(new THREE.Mesh(new THREE.TubeGeometry(support, 16, 0.027, 8, false), brass));
  return group;
}
