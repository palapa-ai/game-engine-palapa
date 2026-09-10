import { load, JSON_SCHEMA } from './hero/vendor/js-yaml.mjs';

export function watchYaml(url, { validate, onData, onError, intervalMs = 3600000 }) {
  let disposed = false, pending = null, timer = 0, previous = '', nextAt = 0;
  const refresh = async () => {
    if (disposed || pending || document.hidden) return;
    const controller = new AbortController();
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {cache:'no-store',signal:controller.signal});
      if (!response.ok) throw Error(`Data request failed (${response.status})`);
      const source = await response.text();
      if (source.length > 1000000) throw Error('Data file is too large');
      const data = validate(load(source, {schema:JSON_SCHEMA}));
      const key = JSON.stringify(data);
      if (!disposed && key !== previous) { await onData(data); previous = key; }
      nextAt = Date.now() + intervalMs;
    } catch (error) {
      if (!disposed) onError?.(error);
      nextAt = Date.now() + Math.min(60000, intervalMs);
    } finally {
      clearTimeout(timeout);
      pending = null;
      if (!disposed) { clearTimeout(timer); timer = setTimeout(refresh, Math.max(0, nextAt - Date.now())); }
    }
  };
  const visibility = () => {
    if (!document.hidden && Date.now() >= nextAt) void refresh();
  };
  document.addEventListener('visibilitychange', visibility);
  void refresh();
  return { refresh, dispose() {
    disposed = true; clearTimeout(timer); pending?.abort();
    document.removeEventListener('visibilitychange', visibility);
  } };
}
