const pending = new Set();
let timer = 0;

function schedule() {
  if (timer || !pending.size || document.hidden) return;
  timer = setTimeout(async () => {
    timer = 0;
    if (document.hidden) return;
    const task = [...pending].find(task => task.visible) || pending.values().next().value;
    if (task) await task.start();
    schedule();
  }, [...pending].some(task => task.visible) ? 0 : 500);
}

export function deferSurface(element, mount) {
  let disposed = false, cleanup = null;
  const task = {
    visible: false,
    async start() {
      if (!pending.delete(task) || disposed) return;
      observer.disconnect();
      try { cleanup = await mount(); } catch (_) { element.dataset.render = 'fallback'; }
      if (disposed) cleanup?.dispose?.();
    },
  };
  const observer = new IntersectionObserver(entries => {
    task.visible = entries.at(-1).isIntersecting;
    if (task.visible) { clearTimeout(timer); timer = 0; }
    schedule();
  }, { rootMargin: '100px' });
  pending.add(task);
  observer.observe(element);
  document.addEventListener('visibilitychange', schedule);
  schedule();
  return { dispose() {
    disposed = true;
    pending.delete(task);
    observer.disconnect();
    document.removeEventListener('visibilitychange', schedule);
    cleanup?.dispose?.();
  } };
}
