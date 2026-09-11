export const TRACE_REVEAL_MS = 400;

// Store the first completed result time for each physical row, bottom to top.
// This follows the vendor's uneven scanline partition exactly, including targets
// shorter than the tile count. A negative time means that row is still untraced.
export class TraceReveal {
  constructor() { this.reset(1, 1); }
  reset(height, rows) {
    if (!Number.isInteger(height) || height < 1 || !Number.isInteger(rows) || rows < 1) {
      throw RangeError('Trace reveal requires positive integer dimensions');
    }
    if (this.height !== height) this.data = new Float32Array(height);
    this.data.fill(-1);
    this.height = height;
    this.rows = rows;
    this.completed = 0;
    this.lastResultAt = -Infinity;
  }
  observe(samples, now) {
    const completed = Math.min(this.rows, Math.floor(samples * this.rows + 1e-8));
    let changed = false;
    for (let row = this.completed; row < completed; row++) {
      const start = Math.floor(this.height * (this.rows - row - 1) / this.rows);
      const end = Math.floor(this.height * (this.rows - row) / this.rows);
      if (start < end) {
        this.data.fill(now / 1000, start, end);
        this.lastResultAt = now;
        changed = true;
      }
    }
    this.completed = Math.max(this.completed, completed);
    return changed;
  }
  settled(now) { return this.completed === this.rows && now - this.lastResultAt >= TRACE_REVEAL_MS; }
}
