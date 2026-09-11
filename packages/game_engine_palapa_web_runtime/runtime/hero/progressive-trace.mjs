export class ProgressiveTrace {
  constructor(target) { this.target = target; this.bounces = 1; }
  advance(samples) {
    if (samples < 1 || this.bounces >= this.target) return false;
    this.bounces = Math.min(this.target, this.bounces * 2);
    return true;
  }
  get settled() { return this.bounces === this.target; }
}
