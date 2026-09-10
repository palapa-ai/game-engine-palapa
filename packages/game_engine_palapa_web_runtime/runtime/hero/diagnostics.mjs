export function createDiagnostics(element, source) {
  let frame = 0, count = 0, start = performance.now(), mode = 0;
  const modes = ['frames', 'tracer'];
  const toggle = () => { mode = (mode + 1) % modes.length; };
  element.addEventListener('click', toggle);
  const tick = time => {
    count++;
    if (time - start >= 500) {
      const fps = Math.round(count * 1000 / (time - start));
      element.textContent = mode === 0 ? `${fps} FPS  dpr ${devicePixelRatio.toFixed(2)}`
        : `${source.state}  ${Math.floor(source.samples)} samples`;
      start = time; count = 0;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return { dispose() { cancelAnimationFrame(frame); element.removeEventListener('click', toggle); } };
}
