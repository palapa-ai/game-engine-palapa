export function traceError(error, operation) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new Error(`${operation} failed: ${detail}`, { cause: error });
}

export function traceStatus(traces) {
  if (!traces.length) return 'Ray tracing off';
  const sources = [...new Set(traces.map(trace => trace.source).filter(Boolean))];
  const failed = sources.filter(source => source.state === 'fallback');
  if (failed.length) {
    const reasons = [...new Set(failed.map(source => source.renderer?.domElement?.dataset?.traceFailure).filter(Boolean))];
    return ['Ray tracing unavailable', ...reasons].join('\n');
  }
  return sources.some(source => ['starting', 'loading'].includes(source.state)) ? 'Preparing ray tracing…' : '';
}
