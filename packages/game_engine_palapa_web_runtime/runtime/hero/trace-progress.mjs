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

// Visibility controls can share one renderer. Report that renderer's work once.
export function traceProgressText(traces) {
  const sources = new Map();
  for (const trace of traces) {
    const key = trace.source ?? trace;
    sources.set(key, sources.has(key) ? { ...trace, label: 'scene' } : trace);
  }
  return [...sources.values()].map(trace => {
    const samples = trace.source?.samples ?? 0;
    const value = samples > 0 && samples < 1 ? samples.toFixed(2) : Math.floor(samples);
    const data = trace.source?.renderer?.domElement?.dataset ?? {};
    const { percent, refining } = traceProgress({
      samples, targetSamples: Number(data.traceTargetSamples), state: trace.source?.state,
      stage: data.traceStage, scale: Number(data.traceResolutionScale),
      bounces: Number(data.traceBounces), targetBounces: Number(data.traceTargetBounces),
      meshCount: Number(data.traceMeshCount),
    });
    return `${percent}% · ${value} spp${refining ? ' · refining' : ''}${sources.size > 1 && trace.label ? ` · ${trace.label.replace(/^Ray trace /i, '')}` : ''}`;
  }).join('\n');
}
