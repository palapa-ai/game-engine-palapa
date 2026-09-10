// Trace the full wall in a bounded backing store; scrolling only moves the layer.
export class Scanlines {
  constructor(width, height, { bandHeight = 48, samples = 8 } = {}) {
    this.width = Math.max(0, Math.floor(width));
    this.height = Math.max(0, Math.floor(height));
    this.bandHeight = Math.max(1, Math.floor(bandHeight));
    this.samples = Math.max(1, Math.floor(samples));
    this.top = 0;
    this.sample = 0;
  }

  next() {
    if (!this.width || this.top >= this.height) return null;
    const height = Math.min(this.bandHeight, this.height - this.top);
    const band = {
      x: 0, y: this.height - this.top - height,
      width: this.width, height, top: this.top, sample: this.sample,
    };
    if (++this.sample === this.samples) {
      this.sample = 0;
      this.top += height;
    }
    return band;
  }

  get done() { return !this.width || this.top >= this.height; }
}

export function visibleBuffer(width, height, pixelRatio = 1, maxPixels = 900000, maxDimension = 4096) {
  if (width <= 0 || height <= 0) return { width: 0, height: 0, scale: 1 };
  const scale = Math.min(pixelRatio, 1, Math.sqrt(maxPixels / (width * height)),
    maxDimension / width, maxDimension / height);
  return { width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)), scale };
}
