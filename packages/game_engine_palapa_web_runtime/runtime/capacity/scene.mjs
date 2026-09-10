import * as THREE from '../hero/vendor/three.module.min.js';
import { FontLoader } from '../hero/vendor/FontLoader.js';
import { TextGeometry } from '../hero/vendor/TextGeometry.js';
import { LineSegments2 } from '../hero/vendor/LineSegments2.js';
import { LineSegmentsGeometry } from '../hero/vendor/LineSegmentsGeometry.js';
import { LineMaterial } from '../hero/vendor/LineMaterial.js';

import { transitionPages } from './transitions.mjs';
import { lightMovingGroup } from './lighting.mjs';

const COLORS = { text: 0xffffff, grey: 0xffffff, green: 0x73c991 };
const LEFT = -0.36;
const RIGHT = 3.4;
const ROW = 0.3;
const FONT_SIZE = 0.18;
const SPIN_SPEED = Math.PI / 4;
const SPIN_DECAY = 1.6;
const MAX_SPIN_SPEED = 12;
const DRAG_THRESHOLD = 6;

export function createCapacity(canvas, options) {
  let renderer, scene, camera, globe, globeBody, coastlines, rim, atmosphere, photoMaterial, outlineMaterial, table, ticker;
  let dead = false, ready = false, visible = false, frame = 0, previous = null;
  let elapsed = 0, period = 0;
  const pages = [], lighting = [];
  let currentPage = 0, transition = null, transitionStyle = 0;
  let width = 0, height = 0, ratio = 1, narrow = false, worldWidth = 1;
  let tableScale = 1, tickerScale = 1, tickerBottom = 0;
  let spinSpeed = SPIN_SPEED, photorealistic = true;
  const textures = new Set();
  const materialsToDispose = new Set();
  const lineMaterials = [];
  const lineResolution = new THREE.Vector2();
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const request = new AbortController();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const comparisons = options.comparisons || [];
  const countries = [...options.countries].sort((a, b) => b.megawattHours - a.megawattHours);
  const models = [...options.models];
  const total = countries.reduce((sum, row) => sum + row.megawattHours, 0);

  const render = () => {
    if (!dead && renderer && visible && !document.hidden) renderer.render(scene, camera);
  };
  const announce = () => {
    const content = currentPage ? `${comparisons[currentPage - 1].title}, ${comparisons[currentPage - 1].unit}: ${comparisons[currentPage - 1].rows.map(row => row.join(', ')).join('; ')}` : countries.map((row, index) => `${index + 1}. ${row.country}, ${row.megawattHours} MWh`).join('; ') + `; Total ${total.toLocaleString('en-US')} MWh.`;
    const modelNames = models.length ? `${options.modelsLabel} ${models.map(row => row.name).join('; ')}.` : '';
    canvas.setAttribute('aria-label', `Country capacity. ${content} ${modelNames} Globe: ${photorealistic ? 'photorealistic' : 'black and white'}. Tap the globe or press G to switch globe views. Tap the table or press Enter, Space, or ArrowRight for the next table. Drag or flick the globe to spin it.`);
  };
  const toggleGlobe = () => {
    if (!ready || dead) return;
    photorealistic = !photorealistic;
    globeBody.material = photorealistic ? (globeBody.userData.tracedPhotoMaterial || photoMaterial) : outlineMaterial;
    coastlines.visible = rim.visible = !photorealistic;
    atmosphere.visible = photorealistic;
    announce();
    render();
  };
  const nextPage = () => {
    if (!ready || dead || transition) return;
    const next = (currentPage + 1) % pages.length;
    if (reduced.matches) {
      pages[currentPage].visible = false;
      pages[next].visible = true;
      currentPage = next;
      announce(); render();
      return;
    }
    transition = { from: currentPage, to: next, start: elapsed, style: transitionStyle };
    transitionStyle = (transitionStyle + 1) % 5;
  };
  const tick = (time) => {
    frame = 0;
    if (dead || !visible || document.hidden || reduced.matches || !ready) return;
    const delta = previous === null ? 0 : Math.min((time - previous) / 1000, 0.05);
    previous = time;
    elapsed += delta;
    if (!touch?.globe) {
      const excess = spinSpeed - SPIN_SPEED;
      const decay = Math.exp(-SPIN_DECAY * delta);
      globe.rotation.y = (globe.rotation.y + SPIN_SPEED * delta + excess * (1 - decay) / SPIN_DECAY) % (Math.PI * 2);
      spinSpeed = Math.abs(excess * decay) < 0.01 ? SPIN_SPEED : SPIN_SPEED + excess * decay;
    }
    table.rotation.y = 0.25 + Math.sin(elapsed * 0.4) * 0.05;
    table.rotation.x = Math.sin(elapsed * 0.27) * 0.03;
    if (transition) {
      const progress = Math.min(1, (elapsed - transition.start) / 0.65);
      transitionPages(pages[transition.from], pages[transition.to], progress, transition.style, table.rotation);
      if (progress === 1) {
        currentPage = transition.to;
        transition = null;
        announce();
      }
    }
    ticker.position.x = -worldWidth / 2 - (elapsed * 0.5) % (period * tickerScale);
    render();
    frame = requestAnimationFrame(tick);
  };
  const refresh = () => {
    cancelAnimationFrame(frame); frame = 0; previous = null;
    if (!visible || document.hidden || reduced.matches) {
      spinSpeed = SPIN_SPEED;
      releaseTouch();
    }
    if (dead || !ready || !visible || document.hidden) return;
    render();
    if (!reduced.matches) frame = requestAnimationFrame(tick);
  };
  let touch = null, suppressClick = false;
  const hitsGlobe = event => {
    if (!ready || dead || !globeBody) return false;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1,
      1 - (event.clientY - bounds.top) / bounds.height * 2);
    camera.updateMatrixWorld();
    globe.updateWorldMatrix(true, true);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObject(globeBody, false).length > 0;
  };
  const releaseTouch = () => {
    const active = touch;
    touch = null;
    if (active && canvas.hasPointerCapture(active.id)) canvas.releasePointerCapture(active.id);
    canvas.style.cursor = 'default';
  };
  const cancel = event => {
    if (touch?.id !== event.pointerId) return;
    suppressClick = true;
    spinSpeed = SPIN_SPEED;
    releaseTouch();
  };
  const down = event => {
    if (!ready || dead) return;
    if (!event.isPrimary) {
      suppressClick = true; spinSpeed = SPIN_SPEED; releaseTouch(); return;
    }
    if (event.button !== 0) return;
    suppressClick = false;
    const onGlobe = hitsGlobe(event);
    if (!onGlobe && event.pointerType !== 'touch') return;
    const bounds = canvas.getBoundingClientRect();
    const worldHeight = 2 * Math.tan(Math.PI / 12) * camera.position.z;
    const diameter = 2 * 0.99 * globe.scale.x * bounds.height / worldHeight;
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY,
      lastX: event.clientX, lastY: event.clientY, time: event.timeStamp,
      vertical: null, globe: onGlobe, speed: spinSpeed, radiansPerPixel: Math.PI / diameter, velocity: 0 };
    if (onGlobe) {
      spinSpeed = 0;
      canvas.style.cursor = 'grabbing';
    }
    canvas.setPointerCapture(event.pointerId);
  };
  const move = event => {
    if (!touch) {
      canvas.style.cursor = hitsGlobe(event) ? 'grab' : 'default';
      return;
    }
    if (event.pointerId !== touch.id) return;
    const dx = event.clientX - touch.x, dy = event.clientY - touch.y;
    if (touch.vertical === null) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      touch.vertical = event.pointerType === 'touch' && Math.abs(dy) >= Math.abs(dx);
      suppressClick = true;
    }
    if (touch.vertical) {
      if (event.cancelable) event.preventDefault();
      options.onScroll(event.clientY - touch.lastY);
    } else if (touch.globe) {
      if (event.cancelable) event.preventDefault();
      const angle = (event.clientX - touch.lastX) * touch.radiansPerPixel;
      const delta = Math.max((event.timeStamp - touch.time) / 1000, 0.001);
      const velocity = Math.max(-MAX_SPIN_SPEED, Math.min(MAX_SPIN_SPEED, angle / delta));
      touch.velocity += (velocity - touch.velocity) * (1 - Math.exp(-delta / 0.045));
      globe.rotation.y = (globe.rotation.y + angle) % (Math.PI * 2);
      render();
    }
    touch.lastX = event.clientX;
    touch.lastY = event.clientY;
    touch.time = event.timeStamp;
  };
  const up = event => {
    if (touch?.id !== event.pointerId) return;
    if (touch.globe) {
      if (touch.vertical === null) spinSpeed = touch.speed;
      else spinSpeed = !reduced.matches && touch.vertical === false && event.timeStamp - touch.time < 100
        ? touch.velocity : SPIN_SPEED;
    }
    releaseTouch();
  };
  const click = event => {
    if (suppressClick) { suppressClick = false; return; }
    if (hitsGlobe(event)) toggleGlobe();
    else nextPage();
  };
  const key = event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['enter', ' ', 'g', 'arrowright'].includes(event.key.toLowerCase())) return;
    event.preventDefault();
    if (!event.repeat) {
      if (event.key.toLowerCase() === 'g') toggleGlobe();
      else nextPage();
    }
  };

  const layout = () => {
    if (!renderer || width <= 0 || height <= 0) return;
    renderer.setPixelRatio(Math.min(ratio, 2));
    renderer.setSize(width, height, false);
    renderer.getDrawingBufferSize(lineResolution);
    for (const material of lineMaterials) {
      material.resolution.copy(lineResolution);
      material.linewidth = 1.25 * lineResolution.x / 516;
    }
    camera.position.z = narrow ? 15.6 : 6.8;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const worldHeight = 2 * Math.tan(Math.PI / 12) * camera.position.z;
    worldWidth = worldHeight * camera.aspect;
    const perPixel = worldHeight / height;
    tableScale = narrow ? Math.min(worldWidth * 0.96 / (RIGHT - LEFT), 21 * worldWidth / width / FONT_SIZE) : 1;
    tickerScale = narrow ? Math.min(2, 21 * worldWidth / width / 0.2) : 1;
    const globeScale = narrow ? Math.min(1.6, worldWidth * 0.46) : 1.3;
    const globeRadius = globeScale * 0.99;
    globe.position.set(narrow ? 0 : -2.5, narrow ? worldHeight / 2 - 18 * perPixel - globeRadius : 0.25, 0);
    globe.scale.setScalar(globeScale);
    rim.position.copy(globe.position); rim.scale.copy(globe.scale);
    table.scale.setScalar(tableScale);
    table.position.set(narrow ? -(RIGHT + LEFT) / 2 * tableScale : 0.5,
      narrow ? globe.position.y - globeRadius - 50 * perPixel - 1.18 * tableScale : 0.3, 0);
    ticker.scale.setScalar(tickerScale);
    const tickerY = narrow ? table.position.y - 1.4 * tableScale - 45 * perPixel - 0.2 * tickerScale : -1.72;
    ticker.position.set(-worldWidth / 2 - (elapsed * 0.5) % (period * tickerScale),
      Math.max(tickerY, -worldHeight / 2 - tickerBottom * tickerScale + 2 * perPixel), 0);
    render();
  };

  const fail = () => {
    if (dead) return;
    options.onFailed('Capacity rendering unavailable');
    dispose();
  };
  const lost = event => { event.preventDefault(); fail(); };
  // NASA Blue Marble: https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57735/land_ocean_ice_cloud_2048.jpg
  const earthTexture = async () => {
    const response = await fetch(options.earthUrl, { signal: request.signal });
    if (!response.ok) throw new Error('Earth image unavailable');
    const url = URL.createObjectURL(await response.blob());
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (dead) return null;
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      textures.add(texture);
      return texture;
    } finally { URL.revokeObjectURL(url); }
  };
  const load = async () => {
    try {
      const [fontJson, earth, rings] = await Promise.all([
        fetch(new URL('../hero/helvetiker_regular.typeface.json', import.meta.url), { signal: request.signal }).then(response => {
          if (!response.ok) throw new Error('Font unavailable');
          return response.json();
        }),
        earthTexture(),
        fetch(options.landUrl, { signal: request.signal }).then(response => {
          if (!response.ok) throw new Error('Land unavailable');
          return response.json();
        }),
      ]);
      if (dead) return;
      const font = new FontLoader().parse(fontJson);
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      scene.add(new THREE.AmbientLight(0x9bb8da, 0.35));
      const light = new THREE.DirectionalLight(0xfff6e5, 2.3);
      light.position.set(-3, 3, 5); scene.add(light);
      globe = new THREE.Group(); globe.rotation.x = 0.42; scene.add(globe);
      earth.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      photoMaterial = new THREE.MeshPhongMaterial({ map: earth, specular: 0x141a22, shininess: 14 });
      outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
      materialsToDispose.add(photoMaterial); materialsToDispose.add(outlineMaterial);
      globeBody = new THREE.Mesh(new THREE.SphereGeometry(0.99, 96, 64), photorealistic ? photoMaterial : outlineMaterial);
      globe.add(globeBody);
      const vector = (longitude, latitude) => {
        const lon = longitude * Math.PI / 180, lat = latitude * Math.PI / 180;
        return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)];
      };
      const land = [];
      for (const ring of rings) {
        for (let index = 2; index + 1 < ring.length; index += 2) {
          land.push(...vector(ring[index - 2], ring[index - 1]), ...vector(ring[index], ring[index + 1]));
        }
      }
      const lines = (points, color) => {
        const geometry = new LineSegmentsGeometry().setPositions(points);
        const material = new LineMaterial({ color, linewidth: 1.25 });
        lineMaterials.push(material);
        return new LineSegments2(geometry, material);
      };
      coastlines = lines(land, COLORS.text); globe.add(coastlines);
      coastlines.visible = !photorealistic;
      const circle = [];
      for (let i = 0; i < 128; i++) {
        for (const a of [i, i + 1]) circle.push(Math.cos(a / 128 * Math.PI * 2) * 0.99, Math.sin(a / 128 * Math.PI * 2) * 0.99, 0);
      }
      rim = lines(circle, 0x3a3a3a); scene.add(rim);
      rim.visible = !photorealistic;
      atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.018, 64, 48),
        new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
          vertexShader: `
            varying vec3 surfaceNormal;
            varying vec3 viewPosition;
            void main() {
              surfaceNormal = normalize(normalMatrix * normal);
              vec4 view = modelViewMatrix * vec4(position, 1.0);
              viewPosition = view.xyz;
              gl_Position = projectionMatrix * view;
            }`,
          fragmentShader: `
            varying vec3 surfaceNormal;
            varying vec3 viewPosition;
            void main() {
              float edge = 1.0 - abs(dot(normalize(surfaceNormal), normalize(-viewPosition)));
              float glow = pow(max(edge, 0.0), 4.0);
              gl_FragColor = vec4(0.20, 0.52, 1.0, glow * 0.55);
            }`,
        }));
      atmosphere.visible = photorealistic; globe.add(atmosphere);
      table = new THREE.Group(); table.rotation.y = 0.25; scene.add(table);
      ticker = new THREE.Group(); scene.add(ticker);
      const text = (label, color, size = FONT_SIZE) => {
        const geometry = new TextGeometry(label, { font, size, depth: size * 0.25, curveSegments: 2 });
        geometry.computeBoundingBox();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }));
        return { mesh, width: geometry.boundingBox.max.x - geometry.boundingBox.min.x };
      };
      const flag = symbol => {
        const surface = document.createElement('canvas'); surface.width = surface.height = 256;
        const context = surface.getContext('2d');
        context.font = '160px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
        context.fillText(symbol, 128, 140);
        const texture = new THREE.CanvasTexture(surface); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
        return new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
      };
      const addText = (page, label, x, y, color, { right = false, maxWidth = Infinity } = {}) => {
        const value = text(label, color);
        value.mesh.scale.setScalar(Math.min(1, maxWidth / Math.max(value.width, 0.001)));
        value.mesh.position.set(x - (RIGHT + LEFT) / 2 - (right ? value.width * value.mesh.scale.x : 0), y + 0.2, 0);
        page.add(value.mesh);
      };
      const addFlag = (page, symbol, x, y) => {
        const mesh = flag(symbol); mesh.position.set(x - (RIGHT + LEFT) / 2, y + 0.27, 0); page.add(mesh);
      };
      const countriesPage = new THREE.Group();
      countriesPage.position.set((RIGHT + LEFT) / 2, -0.2, 0);
      table.add(countriesPage);
      addText(countriesPage, 'MWh', RIGHT, 1, COLORS.grey, { right: true });
      const values = [...countries.map(row => String(row.megawattHours)), total.toLocaleString('en-US')];
      const valueWidth = Math.max(...values.map(value => { const shape = text(value, COLORS.green); const measured = shape.width;
        shape.mesh.geometry.dispose(); shape.mesh.material.dispose(); return measured; }));
      countries.forEach((row, index) => {
        const y = 1 - (index + 1) * ROW;
        addText(countriesPage, `#${index + 1}`, LEFT, y, COLORS.grey);
        addFlag(countriesPage, row.flag, LEFT + 0.63, y);
        addText(countriesPage, row.country, LEFT + 0.95, y, COLORS.text, { maxWidth: RIGHT - valueWidth - 0.2 - (LEFT + 0.95) });
        addText(countriesPage, String(row.megawattHours), RIGHT, y, COLORS.green, { right: true });
      });
      addText(countriesPage, 'Total', LEFT, 1 - (countries.length + 1) * ROW, COLORS.grey);
      addText(countriesPage, total.toLocaleString('en-US'), RIGHT, 1 - (countries.length + 1) * ROW, COLORS.green, { right: true });
      pages.push(countriesPage);
      for (const comparison of comparisons) {
        const page = new THREE.Group();
        page.position.copy(countriesPage.position);
        table.add(page);
        addText(page, comparison.title, LEFT, 1, COLORS.text, { maxWidth: 2.1 });
        addText(page, comparison.unit, RIGHT, 1, COLORS.text, { right: true });
        comparison.rows.forEach(([name, price], index) => {
          const y = 1 - (index + 1) * ROW;
          addText(page, name, LEFT, y, index < 2 ? COLORS.green : COLORS.text, { maxWidth: 2.65 });
          addText(page, price, RIGHT, y, index < 2 ? COLORS.green : 0xf7768e, { right: true });
        });
        page.visible = false;
        pages.push(page);
      }
      let cursor = 0;
      const tickItem = (label, symbol) => {
        const value = text(label, COLORS.text, 0.2);
        value.mesh.position.x = cursor; ticker.add(value.mesh); cursor += value.width;
        if (symbol) { const icon = flag(symbol); icon.position.set(cursor + 0.24, 0.08, 0); ticker.add(icon); cursor += 0.5; }
        const separator = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: COLORS.text }));
        separator.position.set(cursor + 0.2, 0.08, 0); ticker.add(separator); cursor += 0.4;
      };
      for (let copy = 0; copy < 3; copy++) {
        tickItem(options.modelsLabel);
        models.forEach(row => tickItem(row.name, row.flag));
        if (copy === 0) period = cursor;
      }
      ticker.visible = models.length > 0;
      tickerBottom = new THREE.Box3().setFromObject(ticker).min.y;
      ready = true;
      announce(); layout(); refresh();
      for (const group of [...pages, ticker, globeBody]) {
        lighting.push(lightMovingGroup(canvas, group, camera, height || 767, () => {
          if (group === globeBody) {
            globeBody.userData.tracedPhotoMaterial ||= globeBody.material;
            if (!photorealistic) globeBody.material = outlineMaterial;
          }
          render();
        }));
      }
      options.onReady();
    } catch (_) { if (!dead) fail(); }
  };
  let loading = false;
  const observer = new IntersectionObserver(entries => {
    if (dead) return;
    visible = entries[entries.length - 1].isIntersecting;
    if (visible && !loading) { loading = true; void load(); }
    refresh();
  });
  observer.observe(canvas);
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'button');
  canvas.setAttribute('aria-keyshortcuts', 'Enter Space ArrowRight G');
  canvas.setAttribute('aria-label', 'Network capacity is loading.');
  canvas.style.cursor = 'default';
  canvas.style.touchAction = 'pinch-zoom';
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('lostpointercapture', cancel);
  canvas.addEventListener('click', click);
  canvas.addEventListener('keydown', key);
  canvas.addEventListener('webglcontextlost', lost);
  document.addEventListener('visibilitychange', refresh);
  reduced.addEventListener('change', refresh);
  function dispose() {
    if (dead) return;
    dead = true; request.abort(); cancelAnimationFrame(frame); observer.disconnect();
    releaseTouch();
    lighting.forEach(job => job.dispose());
    canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', cancel);
    canvas.removeEventListener('lostpointercapture', cancel);
    canvas.removeEventListener('click', click); canvas.removeEventListener('keydown', key);
    canvas.removeEventListener('webglcontextlost', lost);
    document.removeEventListener('visibilitychange', refresh); reduced.removeEventListener('change', refresh);
    scene?.traverse(object => {
      object.geometry?.dispose();
      const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
      materials.forEach(material => materialsToDispose.add(material));
    });
    materialsToDispose.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose()); renderer?.dispose(); renderer?.forceContextLoss();
  }
  return {
    resize(cssWidth, cssHeight, pixelRatio, isNarrow) {
      if (dead || cssWidth <= 0 || cssHeight <= 0) return;
      if (width === cssWidth && height === cssHeight && ratio === pixelRatio && narrow === isNarrow) return;
      width = cssWidth; height = cssHeight; ratio = pixelRatio; narrow = isNarrow; layout();
    },
    dispose,
  };
}
