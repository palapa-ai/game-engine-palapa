// Keep the raster legible while noisy or undersized targets converge. Resolution
// is pixel coverage, so a target at one eighth in each axis contributes at most
// 1/64 of the final image, even after many samples.
export const TRACE_CONFIDENCE_SAMPLES = 16;

export function traceSampleGoal(selectedSamples) {
  return Math.min(TRACE_CONFIDENCE_SAMPLES, Math.max(1, selectedSamples));
}

export function traceResolutionConfidence(target, viewport) {
  if (!target || !viewport || viewport.width <= 0 || viewport.height <= 0) return 0;
  return Math.min(1, target.width / viewport.width) * Math.min(1, target.height / viewport.height);
}

export function traceConfidence(samples, selectedSamples, resolutionConfidence) {
  return Math.min(1, Math.max(0, samples) / traceSampleGoal(selectedSamples))
    * Math.min(1, Math.max(0, resolutionConfidence));
}

// Only fully trusted results enter history. Repeated low-quality resets must not
// turn a 2% preview into an opaque noisy image by blending it into itself.
export function canPreserveTrace({ samples, selectedSamples, resolutionConfidence, qualitySettled, revealSettled }) {
  return qualitySettled && revealSettled
    && traceConfidence(Math.floor(samples + 1e-8), selectedSamples, resolutionConfidence) >= 1;
}
