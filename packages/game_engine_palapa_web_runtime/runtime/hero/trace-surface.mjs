import { attachTracer } from './tracer.mjs';
import { renderSettings } from './render-settings.mjs';

const queue = new Set();
const CLEAN_SAMPLES = 256;
let timer = 0, running = false;

function schedule() {
  if (timer || running || document.hidden || !queue.size) return;
  timer = setTimeout(pump, [...queue].some(job => job.visible) ? 16 : 150);
}

async function pump() {
  timer = 0;
  if (document.hidden || running) return;
  const jobs = [...queue].filter(job => !job.disposed);
  const job = jobs.find(job => job.visible) || jobs[0];
  if (!job) return;
  running = true;
  try { await job.step(); } finally { running = false; schedule(); }
}

export function traceSurface(canvas, renderer, scene, camera, revision) {
  let tracer = null;
  const quality = renderSettings.value;
  const samples = quality.samples ?? CLEAN_SAMPLES;
  const bounds = canvas.getBoundingClientRect();
  const finish = failed => {
    if (job.disposed) return;
    queue.delete(job);
    if (failed) renderer.render(scene, camera);
    else tracer?.present();
    canvas.dataset.render = failed ? 'fallback' : 'complete';
    canvas.dataset.traceFinishedAt = String(performance.now());
    tracer?.dispose(); tracer = null;
  };
  const job = {
    disposed: false,
    visible: bounds.bottom > 0 && bounds.top < innerHeight,
    async step() {
      try {
        if (!tracer) {
          tracer = await attachTracer(renderer, scene, camera, {
            bounces: quality.bounces, rtRes: 1, fxRes: Math.max(1, canvas.width / (2048 * quality.resolution)), tiles: 2,
          });
          if (job.disposed) { tracer.dispose(); tracer = null; return; }
          canvas.dataset.render = 'tracing';
        }
        if (!tracer.sample(job.visible ? 4 : 2)) { finish(true); return; }
        canvas.dataset.traceSamples = String(tracer.samples);
        canvas.dataset.tracePriority = job.visible ? 'visible' : 'background';
        if (tracer.samples >= samples) finish(false);
      } catch (_) { finish(true); }
    },
  };
  const refresh = () => {
    if (job.visible) { clearTimeout(timer); timer = 0; }
    schedule();
  };
  const observer = new IntersectionObserver(entries => {
    job.visible = entries.at(-1).isIntersecting;
    refresh();
  });
  observer.observe(canvas);
  document.addEventListener('visibilitychange', refresh);
  canvas.dataset.render = 'loading';
  canvas.dataset.traceMethod = 'path-tracing';
  canvas.dataset.traceRevision = revision;
  canvas.dataset.traceTargetSamples = String(samples);
  canvas.dataset.traceBounces = String(quality.bounces);
  canvas.dataset.traceStartedAt = String(performance.now());
  delete canvas.dataset.traceFinishedAt;
  queue.add(job);
  schedule();
  return { dispose() {
    job.disposed = true;
    queue.delete(job);
    observer.disconnect();
    document.removeEventListener('visibilitychange', refresh);
    tracer?.dispose(); tracer = null;
    schedule();
  } };
}
