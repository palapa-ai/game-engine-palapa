export async function revealPage(cover) {
  if (!cover) return;
  try {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    cover.replaceChildren();
    cover.setAttribute('aria-busy', 'false');
    const animation = cover.animate([
      { clipPath: 'inset(0% 0 0 0)' },
      { clipPath: 'inset(100% 0 0 0)' },
    ], { duration: 1600, easing: 'steps(48, end)', fill: 'forwards' });
    await animation.finished;
  } finally {
    cover.remove();
  }
}
