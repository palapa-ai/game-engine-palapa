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

export function createDiagnostics(element, source) {
  const root = element.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{position:fixed;right:12px;top:12px;z-index:20;width:216px;max-height:calc(100dvh - 24px);overflow:auto;color:#fff;background:#151515ed;border:1px solid #444;font:12px/1.5 ui-monospace,monospace;border-radius:6px;box-shadow:0 4px 24px #0006}
    *{box-sizing:border-box}summary{cursor:pointer;padding:12px;font-weight:600}section{padding:0 12px 12px}button{display:block;width:100%;margin-bottom:10px;font:inherit;color:inherit;background:#282828;border:1px solid #555;border-radius:3px;padding:6px;cursor:pointer}button:focus-visible{outline:2px solid #66f5f5}output{display:block;font-variant-numeric:tabular-nums}hr{border:0;border-top:1px solid #444;margin:12px 0}
  </style><details open><summary>Debug</summary><section>
    <button type="button" data-setting="samples"></button>
    <button type="button" data-setting="bounces"></button>
    <button type="button" data-setting="resolution"></button>
    <button type="button" id="reset">Reset</button><hr><output id="fps"></output><output id="page">Loading page…</output><output id="trace">Ray tracing queued</output><output id="spp"></output>
  </section></details>`;
  const choices = { samples: [null, 1, 2, 4, 8, 16, 32, 64], bounces: [1, 2, 4, 8], resolution: [.25, .5, .75, 1, 1.5, 2] };
  const buttons = [...root.querySelectorAll('[data-setting]')];
  const sync = () => buttons.forEach(button => {
    const key = button.dataset.setting, value = renderSettings.value[key];
    button.textContent = key === 'resolution' ? `${value * 100}% resolution` : `${value ?? 'Auto'} ${key}`;
    button.title = key === 'samples' ? 'Samples per pixel. Auto uses 64. Click to cycle.' : 'Click to cycle. Shift-click to go back.';
  });
  buttons.forEach(button => button.addEventListener('click', event => {
    const key = button.dataset.setting, values = choices[key];
    const current = values.indexOf(renderSettings.value[key]);
    renderSettings.update({ [key]: values[(current + (event.shiftKey ? -1 : 1) + values.length) % values.length] });
  }));
  root.getElementById('reset').addEventListener('click', () => {
    renderSettings.update({ samples: null, bounces: 4, resolution: 1 });
    source.resetTracingQuality?.();
  });
  const unsubscribe = renderSettings.subscribe(sync);
  sync();
  const fps = createFrameCounter(root.getElementById('fps'));
  const seconds = milliseconds => `${(milliseconds / 1000).toFixed(2)}s`;
  const read = () => {
    const pageTime = Number(document.body.dataset.pageVisibleAt);
    if (pageTime) root.getElementById('page').textContent = `${seconds(pageTime)} page loading time`;
    const data = source.renderer.domElement.dataset;
    const start = Number(data.traceStartedAt), end = Number(data.traceFinishedAt);
    const active = Number(data.traceBounces), target = renderSettings.value.bounces;
    const resolution = renderSettings.value.resolution * 100;
    const currentResolution = resolution * Number(data.traceResolutionScale || 1);
    root.querySelector('[data-setting="resolution"]').textContent = currentResolution < resolution
      ? `${Number(currentResolution.toFixed(1))} → ${resolution}% resolution` : `${resolution}% resolution`;
    root.querySelector('[data-setting="bounces"]').textContent = active && active < target
      ? `${active} → ${target} bounces` : `${target} bounces`;
    root.getElementById('trace').textContent = source.state === 'fallback' ? 'Ray tracing unavailable'
      : start ? `${seconds((end || performance.now()) - start)} ray tracing time` : 'Ray tracing queued';
    root.getElementById('trace').title = 'Elapsed time since the current scene rebuild began, including setup. Resets when the scene changes; stops at the sample target.';
    root.getElementById('spp').textContent = `${source.samples > 0 && source.samples < 1 ? source.samples.toFixed(2) : Math.floor(source.samples)} spp`;
    root.getElementById('spp').title = 'Accumulated samples per pixel in the visible area at the current resolution.';
    if (start && end) element.dataset.traceDurationMs = String(end - start);
  };
  const timer = setInterval(read, 250);
  read();
  return { dispose() { clearInterval(timer); fps.dispose(); unsubscribe(); root.replaceChildren(); } };
}
