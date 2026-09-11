import * as THREE from '../hero/vendor/three.module.min.js';

export function createPalm({
  height = 1.7, lean = 0.2, bend = 0, thickness = 0.09, rings = 11,
  fronds = 10, length = 1, width = 0.18, rise = 0.4, droop = 0.65,
  yaw = 0, spread = 1, style = 'blade', coconuts = 3, seed = 1,
  leaves = '#65aa24', trunk = '#a27a49', bark = 'rings', notches = 0,
} = {}) {
  const values = [height, lean, bend, thickness, length, width, rise, droop, yaw, spread, seed];
  if (values.some(value => !Number.isFinite(value)) || height <= 0 || thickness <= 0 || length <= 0 || width <= 0 || spread <= 0 ||
      !Number.isInteger(rings) || rings < 2 || rings > 32 || !Number.isInteger(fronds) || fronds < 3 || fronds > 24 ||
      !Number.isInteger(coconuts) || coconuts < 0 || coconuts > 8 || !['blade', 'feather', 'fan', 'crest'].includes(style) ||
      !['rings', 'checks'].includes(bark) || !Number.isInteger(notches) || notches < 0 || notches > 6) {
    throw RangeError('Invalid palm shape');
  }
  const root = new THREE.Group();
  root.name = 'PalmVariation';
  const wood = new THREE.MeshStandardMaterial({ color: trunk, roughness: 0.85, flatShading: true });
  const band = wood.clone();
  band.color.multiplyScalar(0.68);
  const leaf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, side: THREE.DoubleSide, flatShading: true });
  const leafColors = [new THREE.Color(leaves), new THREE.Color(leaves).multiplyScalar(0.76)];
  const axis = new THREE.Vector3(0, 1, 0);
  const sides = bark === 'checks' ? 8 : 7;
  const curve = t => new THREE.Vector3(lean * t * t + bend * Math.sin(Math.PI * t), height * t, 0);
  for (let index = 0; index < rings; index++) {
    const start = curve(index / rings), end = curve((index + 1) / rings);
    const direction = end.clone().sub(start);
    const radius = thickness * (1 - 0.4 * index / rings);
    const geometry = new THREE.CylinderGeometry(radius * 0.95, radius, direction.length() * 1.06, sides);
    if (bark === 'checks') {
      geometry.clearGroups();
      for (let face = 0; face < 8; face++) geometry.addGroup(face * 6, 6, (face + index) % 2);
      geometry.addGroup(48, geometry.index.count - 48, 0);
    }
    const segment = new THREE.Mesh(geometry, bark === 'checks' ? [wood, band] : wood);
    segment.position.copy(start).add(end).multiplyScalar(0.5);
    segment.quaternion.setFromUnitVectors(axis, direction.clone().normalize());
    root.add(segment);
    if (bark === 'rings') {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.02, radius * 1.08, height / rings * 0.12, sides), band);
      ring.position.copy(start);
      ring.quaternion.copy(segment.quaternion);
      root.add(ring);
    }
  }
  let randomSeed = seed >>> 0;
  const random = () => { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0; return randomSeed / 4294967296; };
  const crown = curve(1);
  const vertices = [];
  const triangle = (a, b, c) => vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  const ribbon = (point, sideways, breadth, sections, fold = 0.035) => {
    let previous;
    for (let index = 0; index <= sections; index++) {
      const t = index / sections, center = point(t);
      const halfWidth = breadth * Math.sin(Math.PI * t) ** 0.8;
      const row = [center.clone().addScaledVector(sideways, -halfWidth), center.clone(), center.clone().addScaledVector(sideways, halfWidth)];
      row[1].y += fold * Math.sin(Math.PI * t);
      if (previous) {
        triangle(previous[0], previous[1], row[0]);
        triangle(row[0], previous[1], row[1]);
        triangle(previous[1], previous[2], row[1]);
        triangle(row[1], previous[2], row[2]);
      }
      previous = row;
    }
  };
  if (style === 'crest') {
    // A spaced, front-facing crown stays legible when the entire tree is an icon.
    // Closed ridged leaves retain volume when the user rotates the logo.
    const frond = (control, tip, breadth) => {
      const path = new THREE.QuadraticBezierCurve3(crown, control.add(crown), tip.add(crown));
      let previous;
      const sections = notches ? (notches + 1) * 2 : 10;
      for (let index = 0; index <= sections; index++) {
        const t = index / sections, center = path.getPoint(t), tangent = path.getTangent(t);
        const across = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
        const profile = Math.sin(Math.PI * t) ** 0.7 * (notches && index % 2 === 0 ? 0.6 : 1);
        const row = [center.clone().addScaledVector(across, -breadth * profile),
          center.clone().add(new THREE.Vector3(0, 0, breadth * profile * 0.38)),
          center.clone().addScaledVector(across, breadth * profile),
          center.clone().add(new THREE.Vector3(0, 0, -breadth * profile * 0.38))];
        if (previous) {
          for (let side = 0; side < 4; side++) {
            const next = (side + 1) % 4;
            triangle(previous[side], row[side], previous[next]);
            triangle(row[side], row[next], previous[next]);
          }
        }
        previous = row;
      }
    };
    const pairs = Math.floor(fronds / 2);
    for (let pair = 0; pair < pairs; pair++) {
      const level = pairs === 1 ? 0 : pair / (pairs - 1);
      for (const side of [-1, 1]) {
        const reach = length * spread * (1 - level * 0.28) * (0.96 + random() * 0.08);
        frond(new THREE.Vector3(side * reach * 0.55, rise * (1.1 - level * 0.9), -level * 0.05),
          new THREE.Vector3(side * reach, rise * 0.12 - droop * level, level * 0.07), width * (1 - level * 0.18));
      }
    }
    if (fronds % 2) {
      frond(new THREE.Vector3(-length * 0.12, rise * 0.7, -0.09),
        new THREE.Vector3(length * 0.08, rise * 1.2, -0.1), width * 0.82);
    }
  } else for (let index = 0; index < fronds; index++) {
    const angle = yaw + index * Math.PI * 2 / fronds + (random() - 0.5) * 0.18;
    const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const sideways = new THREE.Vector3(-direction.z, 0, direction.x);
    const reach = length * (0.78 + random() * 0.35);
    const lift = rise * (0.55 + random() * 0.45 + (index % 3 === 0 ? 0.85 : 0));
    const fall = droop * (0.8 + random() * 0.4);
    const point = t => crown.clone().addScaledVector(direction, reach * t * spread)
      .add(new THREE.Vector3(0, lift * Math.sin(Math.PI * t * 0.65) - fall * t * t, 0));
    if (style === 'feather') {
      ribbon(point, sideways, 0.018, 12, 0.008);
      for (let leaflet = 1; leaflet < 12; leaflet++) {
        const t = leaflet / 12, start = point(t);
        for (const side of [-1, 1]) {
          const tip = start.clone().addScaledVector(sideways, side * width * Math.sin(Math.PI * t))
            .addScaledVector(direction, reach * 0.14);
          tip.y -= fall * 0.12 + width * 0.3;
          const cross = tip.clone().sub(start).cross(axis);
          cross.y = cross.length() * 0.5;
          cross.normalize();
          ribbon(fraction => start.clone().lerp(tip, fraction), cross, reach * 0.055, 3, 0.025);
        }
      }
    } else {
      ribbon(point, sideways, width * (style === 'fan' ? 1.6 : 1), style === 'fan' ? 5 : 9);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  const colors = [];
  for (let triangleIndex = 0; triangleIndex < vertices.length / 9; triangleIndex++) {
    const color = leafColors[triangleIndex % 4 < 2 ? 0 : 1];
    for (let corner = 0; corner < 3; corner++) colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  root.add(new THREE.Mesh(geometry, leaf));
  root.rotation.y = style === 'crest' ? yaw : 0;
  if (coconuts) {
    const coconut = new THREE.MeshStandardMaterial({ color: '#654026', roughness: 0.95, flatShading: true });
    const fruit = new THREE.IcosahedronGeometry(thickness * 1.08, 1);
    for (let index = 0; index < coconuts; index++) {
      const angle = index * Math.PI * 2 / coconuts;
      const mesh = new THREE.Mesh(fruit, coconut);
      mesh.position.copy(crown).add(new THREE.Vector3(Math.cos(angle) * thickness, -thickness * 0.65, Math.sin(angle) * thickness));
      root.add(mesh);
    }
  }
  root.updateMatrixWorld(true);
  return root;
}
