import { renderSettings } from './render-settings.mjs';

export function createFrameCounter(element) {
  let frame = 0, count = 0, start = performance.now();
  element.textContent = '… fps';
  const tick = time => {
    count++;
    if (time - start >= 500) {
      element.textContent = `${Math.round(count * 1000 / (time - start))} fps`;
      start = time; count = 0;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return { dispose() { cancelAnimationFrame(frame); } };
}

export function createDiagnostics(element, source, surfaces) {
  const root = element.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{position:fixed;right:12px;top:12px;z-index:20;width:216px;max-height:calc(100dvh - 24px);overflow:auto;color:#fff;background:#151515ed;border:1px solid #444;font:12px/1.5 ui-monospace,monospace;border-radius:6px;box-shadow:0 4px 24px #0006}
    *{box-sizing:border-box}summary{cursor:pointer;padding:12px;font-weight:600}section{padding:0 12px 12px}label{display:grid;grid-template-columns:1fr 88px;align-items:center;gap:8px;margin-bottom:10px}select,button{font:inherit;color:inherit;background:#282828;border:1px solid #555;border-radius:3px;padding:4px;cursor:pointer}output{display:block;font-variant-numeric:tabular-nums}hr{border:0;border-top:1px solid #444;margin:12px 0}button{width:100%}
  </style><details open><summary>Debug</summary><section>
    <label>Samples<select aria-label="Samples"><option value="auto">Auto</option>${[1,2,4,8,16,32,64].map(n => `<option>${n}</option>`).join('')}</select></label>
    <label>Bounces<select aria-label="Bounces">${[1,2,4,8].map(n => `<option>${n}</option>`).join('')}</select></label>
    <label>Resolution<select aria-label="Resolution">${[25,50,75,100,150,200].map(n => `<option value="${n / 100}">${n}%</option>`).join('')}</select></label>
    <button type="button">Reset</button><hr><output id="fps"></output><output id="page">Loading page…</output><output id="trace">Ray tracing queued</output><output id="hero"></output>
  </section></details>`;
  const [samples, bounces, resolution] = root.querySelectorAll('select');
  const sync = () => {
    const value = renderSettings.value;
    samples.value = value.samples ?? 'auto';
    bounces.value = value.bounces;
    resolution.value = value.resolution;
  };
  const update = () => renderSettings.update({
    samples: samples.value === 'auto' ? null : Number(samples.value),
    bounces: Number(bounces.value), resolution: Number(resolution.value),
  });
  root.querySelectorAll('select').forEach(select => select.addEventListener('change', update));
  root.querySelector('button').addEventListener('click', () => renderSettings.update({samples:null,bounces:4,resolution:1}));
  const unsubscribe = renderSettings.subscribe(sync);
  sync();
  const fps = createFrameCounter(root.getElementById('fps'));
  const logged = new Map(), starts = new Map();
  let pageLogged = false, completeKey = '', waveStart = Infinity;
  const seconds = milliseconds => `${(milliseconds / 1000).toFixed(2)} s`;
  const read = () => {
    const pageTime = Number(document.body.dataset.pageVisibleAt);
    if (pageTime && !pageLogged) {
      pageLogged = true;
      root.getElementById('page').textContent = `${seconds(pageTime)} page loaded`;
      console.info(`[engine] Page visible: ${seconds(pageTime)} from navigation`);
    }
    const records = surfaces.map(({name, element}) => {
      const surface = element.matches('[data-render]') ? element : element.querySelector('[data-static-trace], canvas[data-render]');
      return {name, surface, started:Number(surface?.dataset.traceStartedAt) || 0};
    });
    const changed = records.filter(record => record.started && starts.has(record.name) && starts.get(record.name) !== record.started);
    if (changed.length) { waveStart = Math.min(...changed.map(record => record.started)); completeKey = ''; }
    if (!Number.isFinite(waveStart)) {
      const begun = records.filter(record => record.started);
      if (begun.length) waveStart = Math.min(...begun.map(record => record.started));
    }
    records.filter(record => record.started).forEach(record => starts.set(record.name, record.started));
    let complete = 0, failed = 0;
    const keys = [];
    records.forEach(({name, surface}) => {
      if (!surface) return;
      const {render, traceStartedAt, traceFinishedAt} = surface.dataset;
      if (render === 'fallback' || render === 'failed') failed++;
      const started = Number(traceStartedAt), finished = Number(traceFinishedAt);
      if (!started) return;
      const key = `${started}:${finished}:${render}`;
      if (render !== 'complete') return;
      complete++;
      keys.push(key);
      if (finished && logged.get(name) !== key) {
        logged.set(name, key);
        console.info(`[engine] ${name} ray tracing: ${seconds(finished - started)}`, {startedAt:started,finishedAt:finished});
      }
    });
    const now = performance.now();
    const summary = `${complete}/${surfaces.length}`;
    let text = 'Ray tracing queued';
    if (Number.isFinite(waveStart)) text = `${seconds(now - waveStart)} ray tracing`;
    root.getElementById('trace').title = `${summary} sections complete`;
    if (failed) text += ` · ${failed} failed`;
    if (complete === surfaces.length && !failed) {
      const key = keys.join('|');
      if (key !== completeKey) {
        completeKey = key;
        const finished = Math.max(...surfaces.map(({element}) => Number((element.matches('[data-render]') ? element : element.querySelector('[data-static-trace], canvas[data-render]'))?.dataset.traceFinishedAt) || 0));
        element.dataset.traceDurationMs = String(finished - waveStart);
        console.info(`[engine] All static surfaces ray traced: ${seconds(finished - waveStart)}`);
      }
      text = `${seconds(Number(element.dataset.traceDurationMs))} ray traced`;
    }
    root.getElementById('trace').textContent = text;
    root.getElementById('hero').textContent = `${Math.floor(source.samples)} logo samples`;
    root.getElementById('hero').title = source.state;
  };
  const timer = setInterval(read, 250);
  read();
  return { dispose() { clearInterval(timer); fps.dispose(); unsubscribe(); root.replaceChildren(); } };
}
