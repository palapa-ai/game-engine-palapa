import { renderSettings } from './render-settings.mjs';
import { RayStatistics } from './ray-statistics.mjs';
import { traceProgressText } from './trace-progress.mjs';
import { traceStatus } from './trace-failure.mjs';

export function createFrameCounter(element, source) {
  let count = source.frameCount, start = performance.now();
  element.textContent = '… fps';
  const timer = setInterval(() => {
    const time = performance.now(), frames = source.frameCount;
    element.textContent = `${Math.round((frames - count) * 1000 / (time - start))} fps`;
    start = time; count = frames;
  }, 1000);
  return { dispose() { clearInterval(timer); } };
}

export function createDiagnostics(element, source, { traces = [], controls = [] } = {}) {
  const root = element.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{position:fixed;right:12px;top:12px;z-index:20;box-sizing:border-box;width:min(320px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;color:#fff;background:#151515ed;border:1px solid #444;font:12px/1.5 ui-monospace,monospace;border-radius:6px;box-shadow:0 4px 24px #0006}
    *{box-sizing:border-box}label{display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:pointer}input{accent-color:#66f5f5}summary{cursor:pointer;padding:12px;font-weight:600}section{padding:0 12px 12px}button{display:block;width:100%;margin-bottom:10px;font:inherit;color:inherit;background:#282828;border:1px solid #555;border-radius:3px;padding:6px;cursor:pointer}button:focus-visible{outline:2px solid #66f5f5}output{display:block;font-variant-numeric:tabular-nums;white-space:pre-line}output[hidden]{display:none}#spp{white-space:pre;overflow-x:auto}@media(max-width:360px){#spp{white-space:pre-line;overflow-wrap:anywhere}}hr{border:0;border-top:1px solid #444;margin:12px 0}
  </style><details open><summary>Debug</summary><section>
    <div id="traces"></div><div id="controls"></div><button type="button" data-setting="samples"></button>
    <button type="button" data-setting="bounces"></button>
    <button type="button" data-setting="resolution"></button>
    <button type="button" id="reset">Reset</button><hr><output id="fps"></output><output id="download" hidden></output><output id="page">Loading page…</output><output id="rays"></output><output id="rate"></output><output id="spp"></output><output id="trace" hidden></output>
  </section></details>`;
  root.getElementById('controls').append(...controls);
  const traceHandles = traces.map(({ label, settings, source: traceSource }) => {
    const control = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    control.append(input, document.createTextNode(label));
    root.getElementById('traces').append(control);
    const sync = () => { input.checked = settings.value.enabled; };
    input.addEventListener('change', () => settings.update({ enabled: input.checked }));
    const unsubscribe = settings.subscribe(sync);
    sync();
    return { unsubscribe, source: traceSource };
  });
  const choices = { samples: [null, 1, 2, 4, 8, 16, 32, 64], bounces: [1, 2, 4, 8], resolution: [.25, .5, .75, 1, 1.5, 2] };
  const buttons = [...root.querySelectorAll('[data-setting]')];
  const sync = () => buttons.forEach(button => {
    const key = button.dataset.setting, value = renderSettings.value[key];
    button.textContent = key === 'resolution' ? `${value * 100}% resolution` : key === 'samples' ? value === null ? 'Auto · 64 spp' : `${value} spp` : `${value} ${key}`;
    button.title = key === 'samples' ? 'Auto targets 64 samples per pixel, using spare frame time to keep interaction responsive. Click to cycle.' : key === 'resolution' ? 'Current tracing size → selected maximum. Rendering starts smaller and adjusts to available GPU time. Percentages apply to both width and height.' : 'Click to cycle. Shift-click to go back.';
  });
  buttons.forEach(button => button.addEventListener('click', event => {
    const key = button.dataset.setting, values = choices[key];
    const current = values.indexOf(renderSettings.value[key]);
    renderSettings.update({ [key]: values[(current + (event.shiftKey ? -1 : 1) + values.length) % values.length] });
  }));
  root.getElementById('reset').addEventListener('click', () => {
    renderSettings.update({ samples: null, bounces: 4, resolution: 1 });
    source.resetTracingQuality?.();
    traceHandles.forEach(handle => { if (handle.source !== source) handle.source?.resetTracingQuality?.(); });
  });
  const unsubscribe = renderSettings.subscribe(sync);
  sync();
  const fps = createFrameCounter(root.getElementById('fps'), source);
  const statistics = new RayStatistics([source, ...traces.map(trace => trace.source)]);
  const number = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  root.getElementById('rays').title = 'Primary camera rays submitted since this page opened, across the shared scene and its rebuilds. Bounce and shadow rays are not counted.';
  root.getElementById('rate').title = 'Primary camera rays submitted per second of elapsed time, updated every second.';
  root.getElementById('download').title = 'Time spent fetching the page and startup resources before the page reveal, including request latency and cache reads. Simultaneous requests count once; gaps spent setting up and rendering are excluded.';
  const seconds = milliseconds => `${(milliseconds / 1000).toFixed(2)}s`;
  const read = () => {
    const download = document.body.dataset.downloadDurationMs;
    if (download !== undefined) {
      root.getElementById('download').hidden = false;
      root.getElementById('download').textContent = `${(Number(download) / 1000).toFixed(1)} sec downloading`;
    }
    const pageTime = Number(document.body.dataset.pageVisibleAt);
    if (pageTime) root.getElementById('page').textContent = `${seconds(pageTime)} page load`;
    const enabled = traces.length ? traces.filter(trace => trace.settings.value.enabled)
      : renderSettings.value.enabled ? [{ source }] : [];
    const current = enabled.find(trace => trace.source === source)?.source ?? enabled[0]?.source ?? source;
    const data = current.renderer.domElement.dataset;
    const active = Number(data.traceBounces), target = renderSettings.value.bounces;
    const resolution = renderSettings.value.resolution * 100;
    const currentResolution = resolution * Number(data.traceResolutionScale || 1);
    root.querySelector('[data-setting="resolution"]').textContent = currentResolution < resolution
      ? `${Number(currentResolution.toFixed(1))}% → ${resolution}% resolution` : `${resolution}% resolution`;
    root.querySelector('[data-setting="bounces"]').textContent = active && active < target
      ? `${active} → ${target} bounces` : `${target} bounces`;
    const { total, perSecond } = statistics.read();
    root.getElementById('rays').textContent = `${number.format(total)} total rays`;
    root.getElementById('rate').textContent = `${number.format(perSecond)} rays/s`;
    const status = traceStatus(enabled);
    root.getElementById('trace').hidden = !status;
    root.getElementById('trace').textContent = status;
    root.getElementById('spp').textContent = traceProgressText(enabled);
    root.getElementById('spp').title = 'Progress toward the shared scene’s final sample target (Auto: 64 spp), at the selected bounces and resolution within the canvas limits. Preview passes show 0% while refining; 100% waits for the finished image. Scene, camera, visible area, and quality changes restart progress. Total camera rays keep counting.';
  };
  const timer = setInterval(read, 250);
  read();
  return { dispose() { clearInterval(timer); fps.dispose(); unsubscribe(); traceHandles.forEach(handle => handle.unsubscribe()); root.replaceChildren(); } };
}
