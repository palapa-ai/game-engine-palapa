// Resolution belongs to the refinement policy; FrameBudget still decides when
// a measured band is safe to submit. Call advance after observing the current
// target, then preserve the image before applying a returned request.
export class ProgressiveResolution {
  constructor({ targetScale = 1, previewSamples = 4, maxTiles = 32 } = {}) {
    if (!(targetScale > 0 && targetScale <= 1) ||
        !(previewSamples > 0 && Number.isFinite(previewSamples)) ||
        !Number.isInteger(maxTiles) || maxTiles < 1) {
      throw RangeError('Progressive resolution requires a valid target, samples, and tile limit');
    }
    this.targetScale = targetScale;
    this.previewSamples = previewSamples;
    this.maxTiles = maxTiles;
    this.nextRetryAt = 0;
    this.failedAttempts = 0;
    this.pendingScale = null;
  }

  sampleTarget(scale, targetSamples) {
    return scale < this.targetScale
      ? Math.min(this.previewSamples, targetSamples) : targetSamples;
  }

  complete({ samples, scale, targetSamples }) {
    return scale >= this.targetScale && samples >= targetSamples;
  }

  advance({ samples, scale, tiles, now, targetSamples }) {
    const preview = Math.min(this.previewSamples, targetSamples);
    if (this.pendingScale !== null) {
      if (scale < this.pendingScale) {
        // The measured scheduler could not sustain the attempted resolution.
        // Keep refining its fallback while spacing out further upward probes.
        this.failedAttempts++;
        this.nextRetryAt = now + Math.min(30000, 2000 * 2 ** Math.min(4, this.failedAttempts - 1));
        this.pendingScale = null;
      } else if (samples >= preview) {
        this.failedAttempts = 0;
        this.nextRetryAt = 0;
        this.pendingScale = null;
      } else return null;
    }
    if (scale >= this.targetScale || samples < preview || now < this.nextRetryAt) return null;

    const nextScale = Math.min(this.targetScale, scale * 2);
    // Tiles are divisions: twice as many produces four times as many bands,
    // matching the pixel-area increase without assuming driver cost scales.
    const nextTiles = Math.min(this.maxTiles, Math.max(tiles, Math.ceil(tiles * nextScale / scale)));
    this.pendingScale = nextScale;
    return { scale: nextScale, tiles: nextTiles };
  }
}
