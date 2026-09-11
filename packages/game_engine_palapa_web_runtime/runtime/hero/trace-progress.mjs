export function traceProgress({ samples, targetSamples, state, stage, scale, bounces, targetBounces, meshCount }) {
  if (state !== 'tracing' && state !== 'complete') return { percent: 0, refining: false };
  if (state === 'complete' && meshCount === 0) return { percent: 100, refining: false };
  const refining = stage === 'foreground' || !(scale >= 1 && targetBounces > 0 && bounces >= targetBounces);
  if (refining) return { percent: 0, refining: true };
  if (!Number.isFinite(samples) || samples < 0 || !Number.isFinite(targetSamples) || targetSamples <= 0) {
    return { percent: 0, refining: false };
  }
  const percent = state === 'complete' && samples >= targetSamples
    ? 100 : Math.min(99.9, Math.floor(samples / targetSamples * 1000) / 10);
  return { percent, refining: false };
}
