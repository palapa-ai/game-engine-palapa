export class RayStatistics {
  constructor(sources, now = performance.now()) {
    this.sources = [...new Set(sources.filter(Boolean))];
    this.previousTotal = this.total;
    this.previousTime = now;
    this.perSecond = 0;
  }

  get total() {
    return this.sources.reduce((sum, source) => sum + (source.cameraRays ?? 0), 0);
  }

  read(now = performance.now()) {
    const total = this.total;
    const elapsed = now - this.previousTime;
    if (elapsed >= 1000) {
      this.perSecond = Math.max(0, total - this.previousTotal) * 1000 / elapsed;
      this.previousTotal = total;
      this.previousTime = now;
    }
    return { total, perSecond: this.perSecond };
  }
}
