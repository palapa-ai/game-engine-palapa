// Two targets hold trusted history and, temporarily, the foreground result used
// while its backdrop converges. Transient captures always start from trusted
// history, so repeated resets never bake weak previews into one another.
export class TraceHistory {
  constructor() { this.reset(); }
  reset() { this.trustedIndex = -1; this.transientIndex = -1; }
  clearTransient() { this.transientIndex = -1; }
  get sourceIndex() { return this.transientIndex < 0 ? this.trustedIndex : this.transientIndex; }
  capture(draw, { transient = false } = {}) {
    const sourceIndex = transient ? this.trustedIndex : this.sourceIndex;
    const targetIndex = (sourceIndex + 1) % 2;
    // A failed draw may have partially overwritten its destination. Its previous
    // contents must no longer be considered a valid fallback.
    if (this.trustedIndex === targetIndex) this.trustedIndex = -1;
    if (this.transientIndex === targetIndex) this.transientIndex = -1;
    draw(targetIndex, sourceIndex);
    if (transient) this.transientIndex = targetIndex;
    else { this.trustedIndex = targetIndex; this.clearTransient(); }
  }
}
