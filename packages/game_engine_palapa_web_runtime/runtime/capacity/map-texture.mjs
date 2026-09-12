import * as THREE from '../hero/vendor/three.module.min.js';

const mercator = latitude => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));

// Historical scans include borders and legends. Crop to their graticule, then
// undo the Mercator projection before using the usual longitude/latitude UVs.
export function mapLatitudeRow(latitude, south, north) {
  if (latitude < south || latitude > north) return null;
  return (mercator(north) - mercator(latitude)) / (mercator(north) - mercator(south));
}

export function historicalMapTexture(image, { crop, south, north, paper = '#eee4ce' }) {
  const canvas = document.createElement('canvas');
  canvas.width = 4096;
  canvas.height = 2048;
  const context = canvas.getContext('2d');
  context.fillStyle = paper;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const [left, top, right, bottom] = crop;
  const width = image.naturalWidth, height = image.naturalHeight;
  for (let y = 0; y < canvas.height; y++) {
    const latitude = 90 - (y + 0.5) / canvas.height * 180;
    const row = mapLatitudeRow(latitude, south, north);
    // Polar regions absent from the original stay blank paper.
    if (row === null) continue;
    const sourceY = (top + row * (bottom - top)) * height;
    context.drawImage(image, left * width, sourceY, (right - left) * width, 1,
      0, y, canvas.width, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}
