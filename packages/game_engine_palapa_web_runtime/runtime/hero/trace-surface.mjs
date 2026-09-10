import { attachTracer } from './tracer.mjs';

const queue = new Set();
let active = null;

function schedule() {
  if (active || document.hidden) return;
  const job = [...queue].find(job => job.visible && !job.disposed);
  if (!job) return;
  active = job;
  job.start();
}

export function traceSurface(canvas, renderer, scene, camera, revision) {
  let tracer = null, frame = 0, disposed = false, finished = false;
  const bounds = canvas.getBoundingClientRect();
  const job = {
    visible: bounds.bottom > 0 && bounds.top < innerHeight,
    disposed: false,
    async start() {
      if (tracer) { tick(); return; }
      try {
        tracer = await attachTracer(renderer, scene, camera, {
          bounces: 4, rtRes: 1, fxRes: Math.max(1, canvas.width / 1280), tiles: 2,
        });
        if (disposed) { tracer.dispose(); return; }
        canvas.dataset.render = 'tracing';
        refresh();
      } catch (_) { finish(true); }
    },
  };
  const release = () => {
    cancelAnimationFrame(frame);
    tracer?.dispose();
    tracer = null;
    queue.delete(job);
    if (active === job) active = null;
    schedule();
  };
  const finish = failed => {
    if (disposed || finished) return;
    finished = true;
    canvas.dataset.render = failed ? 'fallback' : 'complete';
    if (failed) renderer.render(scene, camera);
    release();
  };
  const tick = () => {
    frame = 0;
    if (disposed || finished || !tracer || document.hidden || !job.visible) return;
    if (!tracer.sample(1)) { finish(true); return; }
    canvas.dataset.traceSamples = String(tracer.samples);
    if (tracer.samples >= 16) finish(false);
    else frame = requestAnimationFrame(tick);
  };
  const refresh = () => {
    if (!disposed && !finished && active === job) {
      if (!job.visible || document.hidden) {
        cancelAnimationFrame(frame); frame = 0;
        if (tracer) active = null;
      } else if (tracer && !frame) tick();
    }
    schedule();
  };
  const observer = new IntersectionObserver(entries => {
    job.visible = entries[entries.length - 1].isIntersecting;
    refresh();
  });
  observer.observe(canvas);
  document.addEventListener('visibilitychange', refresh);
  canvas.dataset.render = 'loading';
  canvas.dataset.traceMethod = 'path-tracing';
  canvas.dataset.traceRevision = revision;
  queue.add(job);
  schedule();
  return {
    dispose() {
      disposed = job.disposed = true;
      observer.disconnect();
      document.removeEventListener('visibilitychange', refresh);
      release();
    },
  };
}
