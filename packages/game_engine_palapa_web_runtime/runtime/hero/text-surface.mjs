import { FontLoader } from './vendor/FontLoader.js';
import { buildTextGroup } from './text3d.mjs';

const fonts = new Map();
function loadFont(url) {
  if (!fonts.has(url)) fonts.set(url, new FontLoader().loadAsync(url).catch(error => {
    fonts.delete(url);
    throw error;
  }));
  return fonts.get(url);
}

export async function createTextSurface(element, { host, fontUrl, content, onReady }) {
  const font = await loadFont(fontUrl);
  let group, width = 0;
  const links = document.createElement('div');
  links.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  element.append(links);
  const release = () => group?.traverse(object => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
  const place = () => {
    if (!group) return;
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2 - document.documentElement.clientWidth / 2;
    const y = -box.top - scrollY;
    if (group.position.x !== x || group.position.y !== y) {
      group.position.set(x, y, 0);
      host.invalidate();
    }
  };
  const resize = () => {
    const next = element.clientWidth;
    if (next > 0 && next !== width) {
      width = next;
      if (group) { host.remove(group); release(); }
      const built = buildTextGroup(font, content(width), width);
      group = built.group;
      element.style.height = `${built.height}px`;
      links.replaceChildren();
      for (const entry of built.layout?.entries || []) {
        if (!entry.href) continue;
        const anchor = document.createElement('a');
        anchor.href = entry.href;
        anchor.textContent = entry.text;
        anchor.style.cssText = `position:absolute;pointer-events:auto;left:${entry.x}px;top:${entry.baseline - entry.size}px;width:${entry.width}px;height:${entry.size * 1.5}px;color:transparent;font-size:${entry.size}px;white-space:nowrap`;
        links.append(anchor);
      }
      host.add(group, { role: 'text' });
      onReady?.(built.height);
    }
    place();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(element);
  resize();
  return { place, resize, dispose() {
    observer.disconnect();
    links.remove();
    if (group) { host.remove(group); release(); }
  } };
}
