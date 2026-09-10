import * as THREE from "./vendor/three.module.min.js";
import { FontLoader } from "./vendor/FontLoader.js";
import { TextGeometry } from "./vendor/TextGeometry.js";
import { traceSurface } from "./trace-surface.mjs";
import { renderSettings } from "./render-settings.mjs";

const TAN = Math.tan(Math.PI / 12);
const HALF_W = 4.15;
const GAP = 0.38;
const LINE = 1.5;
const PAD = 0.6;
const FIRST_BASELINE = 1.1;
const MAX_PIXEL_RATIO = 2;
const MAX_PIXELS = 2000000;

const fonts = new Map();
const loadFont = (url) => {
  if (!url) return Promise.reject(new Error("Font URL required"));
  if (!fonts.has(url)) {
    fonts.set(url, new FontLoader().loadAsync(url)
      .catch((error) => { fonts.delete(url); throw error; }));
  }
  return fonts.get(url);
};

const em = (font, str) => [...str].reduce((width, ch) => {
  const glyph = font.data.glyphs[ch] || font.data.glyphs["?"];
  return width + (glyph?.ha || 0) / font.data.resolution;
}, 0);

const rowEm = (font, row) =>
  row.reduce((width, seg, i) => width + em(font, seg.text) + (i ? GAP : 0), 0);

const word = (font, text, color, size) => {
  const geometry = new TextGeometry(text, {
    font, size, depth: size * 0.2, curveSegments: 2,
  });
  geometry.computeBoundingBox();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 }),
  );
  const { min, max } = geometry.boundingBox;
  return { mesh, w: max.x - min.x, mn: min.x };
};

const light = (scene) => {
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  [
    [0.35, 2, 3, 5],
    [1.5, 2.5, 3, 4],
    [0.4, -3, -1, 2],
  ].forEach(([intensity, x, y, z]) => {
    const lamp = new THREE.DirectionalLight(0xffffff, intensity);
    lamp.position.set(x, y, z);
    scene.add(lamp);
  });
};

const row = (font, segs, size, parent, maxWidth) => {
  const group = new THREE.Group();
  const x = segs.reduce((pen, seg) => {
    const item = word(font, seg.text, seg.color, size);
    item.mesh.position.x = pen - item.mn;
    group.add(item.mesh);
    return pen + item.w + size * GAP;
  }, 0);
  const width = Math.max(0, x - size * GAP);
  const scale = Math.min(1, maxWidth / Math.max(width, 0.001));
  group.scale.setScalar(scale);
  group.position.x = -width * scale / 2;
  parent.add(group);
};

const wrappedLines = (font, spans, size, width) => {
  const lines = [];
  let line = [];
  let used = 0;
  const flush = () => {
    while (line.length && !line.at(-1).text.trim()) line.pop();
    const last = line.at(-1);
    if (last) {
      last.text = last.text.trimEnd();
      last.width = em(font, last.text) * size;
    }
    if (line.length) lines.push(line);
    line = [];
    used = 0;
  };
  const append = (text, span) => {
    const measured = em(font, text) * size;
    if (!line.length && !text.trim()) return;
    if (line.length && used + measured > width) flush();
    if (!line.length && !text.trim()) return;
    const previous = line.at(-1);
    if (previous && !previous.slot && !span.slot && previous.color === span.color && previous.href === span.href) {
      previous.text += text;
      previous.width += measured;
    } else {
      line.push({ ...span, text, width: measured });
    }
    used += measured;
  };
  spans.forEach((span) => {
    if (span.slot) { append(span.text, span); return; }
    span.text.split(/(\s+)/u).filter(Boolean).forEach((token) => {
      if (token.includes("\n")) { flush(); return; }
      if (em(font, token) * size > width) {
        [...token].forEach((ch) => append(ch, span));
      } else {
        append(token, span);
      }
    });
  });
  flush();
  return lines;
};

export function layoutDocument(font, paragraphs, width, inset = 0) {
  const margin = Math.min(Math.max(0, inset), Math.max(0, (width - 1) / 2));
  const measure = Math.max(1, width - 2 * margin);
  const worldPixel = width / (2 * HALF_W);
  const entries = [];
  let baseline = null;
  let height = 0;
  let paragraphTop = 0;
  let gapAfter = 0;

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const size = paragraph.size;
    if (paragraph.dividerColor != null) {
      const top = baseline == null ? paragraphTop : height + gapAfter;
      entries.push({
        dividerColor: paragraph.dividerColor, size, x: 0, top, width,
        paragraphIndex,
      });
      height = top + size;
      paragraphTop = height + (paragraph.gapAfter || 0);
      baseline = null;
      gapAfter = 0;
      return;
    }
    baseline ??= paragraphTop + size + 0.15 * worldPixel;
    const alignment = paragraph.alignment || "start";
    const spans = paragraph.spans || [];
    const gap = paragraph.splitGap ?? size * LINE;
    const splitWidth = spans.reduce((sum, span) => sum + em(font, span.text) * size, 0) +
      gap * Math.max(0, spans.length - 1);
    const split = alignment === "split" && splitWidth <= measure;
    let lines;
    if (split) {
      lines = [spans.map((span) => ({ ...span, width: em(font, span.text) * size }))];
    } else if (alignment === "split") {
      const separator = " ".repeat(Math.ceil(LINE / Math.max(em(font, " "), 0.1)));
      const tail = spans.slice(1).flatMap((span, index) => index
        ? [{ text: separator, color: span.color }, span]
        : [span]);
      lines = [
        ...wrappedLines(font, spans.slice(0, 1), size, measure),
        ...wrappedLines(font, tail, size, measure),
      ];
    } else {
      lines = wrappedLines(font, spans, size, measure);
    }

    lines.forEach((segments) => {
      const ink = segments.reduce((sum, segment) => sum + segment.width, 0);
      let x = margin;
      if (alignment === "center" || (alignment === "split" && !split)) {
        x += (measure - ink) / 2;
      }
      const tailWidth = split
        ? segments.slice(1).reduce((sum, segment) => sum + segment.width, 0) +
          gap * Math.max(0, segments.length - 2)
        : 0;
      segments.forEach((segment, segmentIndex) => {
        if (split && segmentIndex === 1) x = width - margin - tailWidth;
        entries.push({ ...segment, size, x, baseline, paragraphIndex });
        x += segment.width + (split ? gap : 0);
      });
      height = baseline + size * 0.3 + 0.1 * worldPixel;
      baseline += size * LINE;
    });
    gapAfter = paragraph.gapAfter || 0;
    baseline += gapAfter;
  });
  return { entries, height };
}

export function createText3d(canvas, options) {
  let content = {
    rows: [], paragraphs: [], maxSize: 16, fill: 1, inset: 0,
    ...(options.content || options),
  };
  let revision = 0;
  let renderer = null;
  let scene = null;
  let lighting = null;
  let font = null;
  let disposed = false;
  let failed = false;
  let width = 0;
  let ratio = 1;
  let drawn = "";
  let accessible = [];

  const call = (fn, arg) => {
    try { fn?.(arg); } catch (_) {}
  };
  const clearAccessible = () => {
    accessible.forEach((element) => element.remove());
    accessible = [];
  };
  const fail = (why) => {
    if (failed || disposed) return;
    failed = true;
    lighting?.dispose();
    lighting = null;
    canvas.style.visibility = "hidden";
    clearAccessible();
    call(options.onFailed, why);
  };
  const clear = () => {
    lighting?.dispose();
    lighting = null;
    scene?.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry.dispose();
      object.material.dispose();
    });
    scene = null;
  };
  const semantics = (layout) => {
    const parent = canvas.parentElement;
    if (!parent) return;
    const focused = document.activeElement?.dataset?.text3dLink;
    clearAccessible();
    const paragraphs = content.paragraphs.length
      ? content.paragraphs
      : content.rows.map((spans) => ({ spans }));
    paragraphs.forEach((paragraph) => {
      const text = paragraph.spans.filter((span) => !span.href && !span.slot).map((span) => span.text).join(" ");
      if (!text.trim()) return;
      const label = document.createElement(paragraph.heading ? "h2" : "p");
      label.textContent = text;
      label.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;margin:0;";
      parent.appendChild(label);
      accessible.push(label);
    });
    layout?.entries.filter(entry => entry.slot).forEach(entry => {
      const slot = document.createElement('span');
      slot.dataset.text3dSlot = entry.slot;
      slot.style.cssText = `position:absolute;left:${entry.x}px;top:${entry.baseline - entry.size}px;width:${entry.width}px;height:${entry.size * LINE}px;font:${entry.size}px/1.5 sans-serif;color:#${entry.color.toString(16).padStart(6, '0')};white-space:nowrap;`;
      parent.append(slot);
      accessible.push(slot);
      options.onSlot?.(entry.slot, slot);
    });
    layout?.entries.filter((entry) => entry.href).forEach((entry, index) => {
      const anchor = document.createElement("a");
      anchor.href = entry.href;
      anchor.textContent = entry.text;
      anchor.dataset.text3dLink = String(index);
      anchor.style.cssText = "position:absolute;display:block;pointer-events:auto;cursor:pointer;color:transparent;background:transparent;white-space:nowrap;box-sizing:border-box;";
      anchor.style.left = Math.max(0, entry.x - 4) + "px";
      anchor.style.top = Math.max(0, entry.baseline - entry.size - 4) + "px";
      anchor.style.width = Math.min(width - Math.max(0, entry.x - 4), entry.width + 8) + "px";
      anchor.style.height = entry.size * LINE + 8 + "px";
      parent.appendChild(anchor);
      accessible.push(anchor);
      if (focused === String(index)) anchor.focus({ preventScroll: true });
    });
  };

  const draw = () => {
    if (!font || !renderer || disposed || failed || !(width > 0)) return;
    if (!content.rows.length && !content.paragraphs.length) return;
    const key = String(width) + "x" + ratio + ":" + revision;
    if (key === drawn) return;
    let layout = null;
    let size = 0;
    let height = 0;
    if (content.paragraphs.length) {
      layout = layoutDocument(font, content.paragraphs, width, content.inset);
      height = layout.height;
    } else {
      const widest = Math.max(...content.rows.map((segments) => rowEm(font, segments)));
      size = Math.min(content.maxSize, content.fill * width / Math.max(widest, 1));
      height = (content.rows.length * LINE + PAD) * size;
    }
    const scale = Math.min(
      ratio * renderSettings.value.resolution, MAX_PIXEL_RATIO * renderSettings.value.resolution, Math.sqrt(MAX_PIXELS / (width * height)),
      renderer.capabilities.maxTextureSize / Math.max(width, height),
    );
    renderer.setSize(
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)), false,
    );
    clear();
    scene = new THREE.Scene();
    light(scene);
    const world = 2 * HALF_W / width;
    const half = height * world / 2;
    if (layout) {
      layout.entries.forEach((entry) => {
        if (entry.slot) return;
        if (entry.dividerColor != null) {
          const thickness = entry.size * world;
          const depth = thickness * 0.2;
          const opacity = (entry.dividerColor >>> 24) / 255;
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(entry.width * world, thickness, depth),
            new THREE.MeshStandardMaterial({
              color: entry.dividerColor & 0xffffff,
              opacity, transparent: opacity < 1,
              roughness: 0.35, metalness: 0.05,
            }),
          );
          mesh.position.set(
            -HALF_W + (entry.x + entry.width / 2) * world,
            half - (entry.top + entry.size / 2) * world,
            -depth / 2,
          );
          scene.add(mesh);
          return;
        }
        const item = word(font, entry.text, entry.color, entry.size * world);
        // Keep the front face on the measured plane so links and canvas edges agree.
        item.mesh.position.set(
          -HALF_W + entry.x * world,
          half - entry.baseline * world,
          -entry.size * world * 0.2,
        );
        scene.add(item.mesh);
      });
    } else {
      const face = size * world;
      content.rows.forEach((segments, index) => {
        const line = new THREE.Group();
        line.position.y = half - face * (FIRST_BASELINE + index * LINE);
        line.position.z = -face * 0.2;
        scene.add(line);
        row(font, segments, face, line, (width - 4) * world);
      });
    }
    const camera = new THREE.PerspectiveCamera(
      30, HALF_W / half, 0.1, Math.max(50, half / TAN + 20),
    );
    camera.position.z = half / TAN;
    renderer.render(scene, camera);
    canvas.style.visibility = "visible";
    semantics(layout);
    drawn = key;
    call(options.onReady, height);
    if (disposed || failed) return;
    const tracedScene = scene;
    const tracedRenderer = renderer;
    try {
      lighting = traceSurface(canvas, tracedRenderer, tracedScene, camera, key);
    } catch (_) {
      canvas.dataset.render = "fallback";
      canvas.dataset.traceFailure = "lighting-unavailable";
    }
  };
  const attemptDraw = () => {
    try { draw(); } catch (error) { fail(String(error?.message || error)); }
  };

  const unsubscribe = renderSettings.subscribe(() => { revision++; attemptDraw(); });

  loadFont(options.fontUrl).then((loaded) => {
    if (disposed) return;
    font = loaded;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch (_) {
      return fail("no-webgl");
    }
    attemptDraw();
  }).catch((error) => fail(String(error?.message || error)));

  const contextLost = (event) => {
    event.preventDefault();
    fail("context-lost");
  };
  canvas.addEventListener("webglcontextlost", contextLost);

  return {
    resize(cssWidth, pixelRatio) {
      if (disposed || !(cssWidth > 0)) return;
      width = cssWidth;
      ratio = pixelRatio > 0 ? pixelRatio : 1;
      attemptDraw();
    },
    update(next) {
      if (disposed || failed || JSON.stringify(next) === JSON.stringify(content)) return;
      content = { ...content, ...next };
      revision++;
      attemptDraw();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      canvas.removeEventListener("webglcontextlost", contextLost);
      clearAccessible();
      try { clear(); renderer?.dispose(); } catch (_) {}
    },
  };
}

export default createText3d;
