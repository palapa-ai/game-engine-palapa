const defaults = Object.freeze({ samples: null, bounces: 4, resolution: 1, traceMode: 'scene' });
let current = defaults;
const listeners = new Set();
export const renderSettings = {
  get value() { return current; },
  update(next) {
    const value = { ...current, ...next };
    if (value.samples !== null && (!Number.isInteger(value.samples) || value.samples < 1 || value.samples > 1024)) throw RangeError('Samples must be 1–1024 or auto');
    if (!Number.isInteger(value.bounces) || value.bounces < 1 || value.bounces > 8) throw RangeError('Bounces must be 1–8');
    if (!Number.isFinite(value.resolution) || value.resolution < 0.25 || value.resolution > 2) throw RangeError('Resolution must be 25–200%');
    if (!['text', 'scene'].includes(value.traceMode)) throw RangeError('Trace mode must be text or scene');
    if (Object.keys(defaults).every(key => current[key] === value[key])) return;
    current = Object.freeze(value);
    listeners.forEach(listener => listener(current));
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
