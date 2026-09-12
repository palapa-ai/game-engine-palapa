import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../runtime/hero/vendor/three.module.min.js';
import { createCapacity } from '../runtime/capacity/scene.mjs';

test('capacity traces the settled table and only rebuilds when its geometry changes', async t => {
  const globals = new Map();
  const install = (name, value) => {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  t.after(() => globals.forEach((descriptor, name) => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }));
  const bounds = { left: 80, top: 300, width: 640, height: 700 };
  const hostBounds = { left: 0, top: -100, width: 800, height: 800 };
  class Element extends EventTarget {
    style = {};
    capturedPointer = null;
    setAttribute(name, value) { this[name] = value; }
    getBoundingClientRect() { return bounds; }
    getContext(kind) {
      assert.equal(kind, '2d', 'the shared component must not create a private graphics context');
      return {
        fillText() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
        createLinearGradient: () => ({ addColorStop() {} }),
        getImageData: () => ({ data: new Uint8Array(256 * 256 * 4) }),
      };
    }
    setPointerCapture(id) { this.capturedPointer = id; }
    hasPointerCapture(id) { return this.capturedPointer === id; }
    releasePointerCapture() { this.capturedPointer = null; }
  }
  const media = Object.assign(new EventTarget(), { matches: false });
  install('scrollY', 100);
  install('document', Object.assign(new EventTarget(), { hidden: false, createElement: () => new Element() }));
  install('matchMedia', () => media);
  install('IntersectionObserver', class {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  });
  install('Image', class { async decode() {} });
  install('requestAnimationFrame', () => assert.fail('capacity must use the shared host clock'));
  install('cancelAnimationFrame', () => assert.fail('capacity must use the shared host clock'));
  const font = {
    resolution: 1000, boundingBox: { yMin: 0, yMax: 700 }, underlineThickness: 50,
    glyphs: { '?': { ha: 600, o: 'm 0 0 l 500 0 l 500 700 l 0 700 l 0 0' }, ' ': { ha: 300, o: '' } },
  };
  install('fetch', async url => new Response(url === 'font' ? JSON.stringify(font) : url === 'land' ? '[]' : 'earth'));
  const groups = [], callbacks = new Set();
  let geometryChanges = 0, dynamicChanges = 0;
  const host = {
    camera: new THREE.OrthographicCamera(-400, 400, 0, -800, 0.1, 10000),
    renderer: {
      capabilities: { getMaxAnisotropy: () => 4 },
      domElement: { getBoundingClientRect: () => hostBounds },
      getDrawingBufferSize: vector => vector.set(1600, 1600),
    },
    add(group, options = {}) {
      assert.equal(group.isGroup, true);
      assert.notEqual(options.dynamic, true, 'the whole capacity group must not be excluded from tracing');
      groups.push(group);
    },
    remove(group) { groups.splice(groups.indexOf(group), 1); },
    tick(callback) { callbacks.add(callback); return () => callbacks.delete(callback); },
    invalidate(options = {}) {
      if (options.dynamic) dynamicChanges++;
      else geometryChanges++;
    },
  };
  host.camera.position.z = 2000;
  let ready, failed;
  const loaded = new Promise((resolve, reject) => { ready = resolve; failed = reject; });
  const anchor = new Element();
  const control = createCapacity(anchor, {
    host, fontUrl: 'font', earthUrl: 'earth', landUrl: 'land',
    countries: [{ country: 'Example', flag: 'X', megawattHours: 1 }],
    comparisons: [{ title: 'Example model', unit: '1M tokens', rows: [['Local', '$0.01']] }],
    models: [{ name: 'Example (A | B)', flag: 'X' }],
    onReady: ready, onFailed: failed, onScroll() {},
  });
  t.after(() => control.dispose());
  control.resize(640, 700, 2, true, 12);
  await loaded;
  assert.equal(groups.length, 1);
  assert.equal(callbacks.size, 1);
  const root = groups[0], table = root.getObjectByName('capacity-table');
  const globe = root.getObjectByName('capacity-globe'), ticker = root.getObjectByName('capacity-ticker');
  assert.notEqual(root.userData.dynamic, true);
  assert.notEqual(table.userData.dynamic, true);
  assert.equal(globe.userData.dynamic, true);
  assert.equal(ticker.userData.dynamic, true);
  assert.equal(table.children[0].visible, true);
  assert.equal(table.children[1].visible, false);
  assert.equal(table.children[1].userData.dynamic, true, 'hidden page geometry must stay outside the BVH');
  assert.equal(root.position.y, -750);
  assert.equal(ticker.children[0].material.clippingPlanes[0].constant, 320, 'ticker uses the full container');

  let now = 0;
  const advance = frames => {
    for (let frame = 0; frame < frames; frame++) {
      now += 50;
      for (const callback of callbacks) callback(now);
    }
  };
  const initialChanges = geometryChanges;
  const tableRotation = table.rotation.clone(), globeRotation = globe.rotation.y;
  advance(30);
  assert.equal(geometryChanges, initialChanges, 'idle animation must not restart the static trace');
  assert.ok(table.rotation.equals(tableRotation));
  assert.notEqual(globe.rotation.y, globeRotation);
  assert.ok(dynamicChanges > 0);

  await t.test('scrolling during a captured globe drag preserves its position within the shared canvas', () => {
    host.camera.updateMatrixWorld();
    globe.updateWorldMatrix(true, true);
    const center = globe.getWorldPosition(new THREE.Vector3()).project(host.camera);
    const x = hostBounds.left + (center.x + 1) * hostBounds.width / 2;
    const y = hostBounds.top + (1 - center.y) * hostBounds.height / 2;
    const pointerEvent = (type, clientX, timeStamp) => {
      const event = new Event(type, { cancelable: true });
      Object.defineProperties(event, Object.fromEntries(Object.entries({
        pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0,
        clientX, clientY: y, timeStamp,
      }).map(([name, value]) => [name, { value }])));
      anchor.dispatchEvent(event);
    };
    const position = root.position.clone();
    pointerEvent('pointerdown', x, now);
    assert.equal(anchor.hasPointerCapture(1), true, 'the pointer must actually hit and hold the globe');
    pointerEvent('pointermove', x + 20, now + 16);
    const rotation = globe.rotation.y;

    bounds.top -= 48;
    hostBounds.top -= 48;
    pointerEvent('pointermove', x + 40, now + 32);
    assert.ok(root.position.equals(position), 'host and anchor scroll together even before window scroll metrics catch up');
    assert.notEqual(globe.rotation.y, rotation, 'dragging continues to rotate the globe');
    globalThis.scrollY += 48;
    pointerEvent('pointermove', x + 60, now + 48);
    assert.ok(root.position.equals(position), 'window scroll updates must not move the globe a second time');
    assert.equal(geometryChanges, initialChanges, 'a drag and scroll must not rebuild the static table');
    pointerEvent('pointerup', x + 60, now + 64);
    assert.equal(anchor.hasPointerCapture(1), false);
  });

  const meridian = root.getObjectByName('antique-globe-meridian');
  for (const style of ['black and white', 'antique', 'photorealistic']) {
    const before = geometryChanges;
    const wasVisible = meridian.visible;
    anchor.dispatchEvent(Object.assign(new Event('keydown'), { key: 'g' }));
    assert.ok(anchor['aria-label'].includes(`Globe: ${style}.`));
    assert.equal(meridian.visible, style === 'antique');
    assert.equal(geometryChanges, before + Number(wasVisible !== meridian.visible), 'only mounting visibility changes rebuild its shadows');
  }
  const afterStyleChanges = geometryChanges;
  const globeOccluder = root.getObjectByName('sphere-shadow-occluder');
  assert.ok(globeOccluder.position.equals(globe.position));
  assert.ok(globeOccluder.scale.equals(globe.scale));
  assert.notEqual(globeOccluder.userData.dynamic, true);

  const next = () => anchor.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }));
  next();
  assert.equal(table.userData.dynamic, true);
  assert.equal(geometryChanges, afterStyleChanges + 1, 'exclude the table at transition start');
  advance(5);
  assert.equal(geometryChanges, afterStyleChanges + 1, 'transition frames only update dynamic geometry');
  advance(10);
  assert.equal(table.userData.dynamic, false);
  assert.equal(table.children[0].visible, false);
  assert.equal(table.children[0].userData.dynamic, true);
  assert.equal(table.children[1].visible, true);
  assert.equal(table.children[1].userData.dynamic, false);
  assert.equal(geometryChanges, afterStyleChanges + 2, 'retrace once when the new page settles');
  advance(20);
  assert.equal(geometryChanges, afterStyleChanges + 2);

  next();
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  assert.equal(table.userData.dynamic, false, 'reduced motion settles an in-flight transition');
  assert.equal(table.children[0].visible, true);
  assert.equal(callbacks.size, 0);
  assert.equal(geometryChanges, afterStyleChanges + 4);
  next();
  assert.equal(table.children[1].visible, true);
  assert.equal(table.userData.dynamic, false);
  assert.equal(geometryChanges, afterStyleChanges + 5, 'a reduced-motion page change retraces once');

  control.resize(640, 700, 2, true, 12);
  assert.equal(geometryChanges, afterStyleChanges + 5);
  bounds.top -= 40;
  hostBounds.top -= 40;
  globalThis.scrollY += 40;
  control.resize(640, 700, 2, true, 12);
  assert.equal(geometryChanges, afterStyleChanges + 5, 'scrolling does not change document-space geometry');
  bounds.top += 20;
  control.resize(640, 700, 2, true, 12);
  assert.equal(geometryChanges, afterStyleChanges + 6, 'a real anchor movement updates the static table');
  control.resize(640, 700, 1, true, 12);
  assert.equal(geometryChanges, afterStyleChanges + 6, 'pixel ratio changes do not change scene geometry');
  control.resize(640, 700, 1, false, 12);
  assert.equal(geometryChanges, afterStyleChanges + 7, 'responsive layout changes retrace once');
  control.dispose();
  assert.equal(groups.length, 0);
  assert.equal(callbacks.size, 0);
});
