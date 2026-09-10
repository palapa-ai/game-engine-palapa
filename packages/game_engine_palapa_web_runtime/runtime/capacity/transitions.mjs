export function transitionPages(a, b, progress, style, rotation) {
  for (const page of [a, b]) {
    page.rotation.set(0, 0, 0);
    page.scale.setScalar(1);
  }
  const outgoing = progress < 0.5;
  a.visible = outgoing;
  b.visible = !outgoing;
  const page = outgoing ? a : b;
  const half = outgoing ? progress * 2 : (1 - progress) * 2;
  const sign = outgoing ? 1 : -1;
  if (style === 0) page.rotation.y = half * (sign * Math.PI / 2 - rotation.y);
  else if (style === 1) page.rotation.x = half * (sign * Math.PI / 2 - rotation.x);
  else {
    page.scale.setScalar(Math.max(0.001, 1 - half));
    if (style === 3) page.rotation.z = sign * half * Math.PI / 2;
    if (style === 4) page.rotation.y = sign * half * Math.PI;
  }
}
