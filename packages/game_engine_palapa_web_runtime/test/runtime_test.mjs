import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import { transitionPages } from '../runtime/capacity/transitions.mjs';
import * as THREE from '../runtime/hero/vendor/three.module.min.js';
import { FontLoader } from '../runtime/hero/vendor/FontLoader.js';
import { layoutDocument, buildTextGroup } from '../runtime/hero/text3d.mjs';
import { revealPage } from '../runtime/hero/reveal.mjs';

const root = new URL('../runtime/', import.meta.url);
const fontFixture = {
  resolution: 1000,
  glyphs: { '?': { ha: 700 }, ' ': { ha: 350 } },
};
test('scanline reveal releases the page after animation, cancellation, or reduced motion', async () => {
  for (const mode of ['animated', 'cancelled', 'reduced']) {
    let removed = false, animated = false;
    globalThis.matchMedia = () => ({matches: mode === 'reduced'});
    const cover = {
      replaceChildren() {}, setAttribute() {},
      remove() { removed = true; },
      animate(frames, timing) {
        animated = true;
        assert.equal(removed, false);
        assert.deepEqual(frames.map(frame => frame.clipPath), ['inset(0% 0 0 0)', 'inset(100% 0 0 0)']);
        assert.match(timing.easing, /^steps\(/);
        return { finished: mode === 'cancelled' ? Promise.reject(Error('cancelled')) : Promise.resolve() };
      },
    };
    if (mode === 'cancelled') await assert.rejects(revealPage(cover), /cancelled/);
    else await revealPage(cover);
    assert.equal(removed, true);
    assert.equal(animated, mode !== 'reduced');
  }
});
test('each table transition reveals exactly one page and restores its pose', () => {
  for (let style = 0; style < 5; style++) {
    const a = new THREE.Group(), b = new THREE.Group();
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      transitionPages(a, b, progress, style, {x: 0.03, y: 0.25});
      assert.notEqual(a.visible, b.visible);
      assert.ok(a.scale.x > 0 && b.scale.x > 0);
    }
    assert.equal(b.visible, true);
    assert.equal(Math.abs(b.rotation.x), 0);
    assert.equal(Math.abs(b.rotation.y), 0);
    assert.equal(Math.abs(b.rotation.z), 0);
    assert.equal(b.scale.x, 1);
  }
});
test('runtime assets resolve locally without website or native-engine dependencies', async () => {
  async function visit(directory) {
    for (const entry of await readdir(directory, {withFileTypes:true})) {
      const url = new URL(entry.name, directory);
      if (entry.isDirectory()) { await visit(new URL(entry.name+'/', directory)); continue; }
      if (!/\.(mjs|js)$/.test(entry.name)) continue;
      const source = await readFile(url, 'utf8');
      for (const match of source.matchAll(/(?:from\s*|import\s*\(|new URL\(\s*)["'](\.[^"']+)["']/g)) {
        const dependency = new URL(match[1], url);
        assert.ok(dependency.href.startsWith(root.href), dependency.href);
        await access(dependency);
      }
    }
  }
  await visit(root);
});
test('text layout keeps long words and links within narrow surfaces', async () => {
  const font = new FontLoader().parse(fontFixture);
  const layout = layoutDocument(font, [{spans:[{text:'Distributed supercomputer Privacy',color:0xffffff,href:'/privacy-policy'}],size:18}], 220);
  assert.ok(layout.entries.length > 1);
  for (const entry of layout.entries) {
    assert.ok(entry.x >= 0);
    assert.ok(entry.x + entry.width <= 220.01);
  }
});

test('download controls navigate for Mac and iOS, with status only for Windows', async () => {
  const {createLaunchControls} = await import('../runtime/hero/launch.mjs');
  class Element extends EventTarget {
    constructor(tag = '') { super(); this.tag = tag; this.style = {}; this.dataset = {}; this.children = []; this.classList = {add(){}}; }
    append(...children) { children.forEach(child => { child.parentElement = this; this.children.push(child); }); }
    setAttribute(name,value) { this[name] = value; }
    attachShadow() { this.shadowRoot = new Element(); return this.shadowRoot; }
    replaceChildren() { this.children = []; }
    querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  }
  const navigations = [];
  globalThis.document = {createElement: tag => new Element(tag)};
  globalThis.window = {location:{assign:href => navigations.push(href)}};
  globalThis.matchMedia = () => ({matches:true,addEventListener(){},removeEventListener(){}});
  globalThis.devicePixelRatio = 1;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const host = new Element();
  const targets = [{id:'mac',label:'Mac',href:'https://example.com/app.dmg'},{id:'ios',label:'iOS',href:'https://example.com/ios'},{id:'windows',label:'WIN',href:null}];
  const controls = createLaunchControls(host,{targets,index:0,comingSoon:'Coming soon',onFocus(){},onBlur(){}});
  const [download,cycle] = host.shadowRoot.querySelectorAll('button');
  download.dispatchEvent(new Event('click'));
  cycle.dispatchEvent(new Event('click'));
  download.dispatchEvent(new Event('click'));
  cycle.dispatchEvent(new Event('click'));
  download.dispatchEvent(new Event('click'));
  assert.deepEqual(navigations, targets.slice(0,2).map(target => target.href));
  assert.equal(host.shadowRoot.querySelectorAll('span')[0].textContent,'Coming soon');
  cycle.dispatchEvent(new Event('click'));
  assert.equal(host.shadowRoot.querySelectorAll('span')[0].textContent,'');
  controls.dispose();
});

test('geometry lighting traces rays and returns finite surface colors', async () => {
  const {Worker} = await import('node:worker_threads');
  const moduleUrl = new URL('../runtime/hero/static-lighting-worker.mjs',import.meta.url).href;
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(`
    import {parentPort} from 'node:worker_threads';
    globalThis.self = {};
    globalThis.postMessage = (data) => parentPort.postMessage(data);
    await import(${JSON.stringify(moduleUrl)});
    parentPort.on('message', data => self.onmessage({data}));
  `)));
  try {
    const geometry = new THREE.PlaneGeometry(1,1,4,4);
    const camera = new THREE.PerspectiveCamera(30,1,0.1,50);
    camera.position.z = 3;
    camera.updateMatrixWorld();
    const result = new Promise((resolve,reject) => {
      worker.on('error',reject);
      worker.on('message', data => {
        if(data.type === 'error') reject(new Error(data.error));
        if(data.type === 'complete') resolve(data);
      });
    });
    worker.postMessage({type:'start',id:1,meshes:[{
      positions:geometry.attributes.position.array,normals:geometry.attributes.normal.array,
      indices:geometry.index.array,matrix:new THREE.Matrix4().toArray(),color:[1,1,1],opacity:1,
    }],ambient:[0.75,0.75,0.75],lights:[{direction:[0,0,1],color:[1,1,1]}],
      projection:new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).toArray(),
      eye:[0,0,3],height:200,bandHeight:32,cursor:0,rays:0,bands:0});
    const data = await result;
    assert.ok(data.rays > 0);
    assert.ok(data.updates.flatMap(entry => [...entry.colors]).every(Number.isFinite));
  } finally { await worker.terminate(); }
});

test('live text slots retain a single reserved space across wrapping and split alignment', async () => {
  const font = new FontLoader().parse(fontFixture);
  for (const width of [180, 880]) {
    const layout = layoutDocument(font, [{spans:[{text:'Copyright',color:0x9e9e9e},{text:'Terms · Privacy · ',color:0x9e9e9e},{text:'000 FPS',slot:'fps',color:0x9e9e9e},{text:' · debug',color:0x9e9e9e}],size:12,alignment:'split',splitGap:0}], width);
    const slots = layout.entries.filter(entry => entry.slot);
    assert.equal(slots.length,1);
    assert.equal(slots[0].text,'000 FPS');
    assert.ok(layout.entries.every(entry => entry.x >= 0 && entry.x + entry.width <= width + .01));
  }
});

test('render settings notify only real valid changes and release disposed subscribers', async () => {
  const {renderSettings} = await import('../runtime/hero/render-settings.mjs');
  assert.equal(renderSettings.value.traceMode, 'scene');
  const seen = [];
  const unsubscribe = renderSettings.subscribe(value => seen.push(value));
  renderSettings.update({samples:64,resolution:.5,bounces:2});
  renderSettings.update({samples:64});
  assert.equal(seen.length,1);
  for (const invalid of [{samples:0},{samples:NaN},{bounces:9},{resolution:Infinity},{traceMode:'wall'},{traceMode:null}]) assert.throws(() => renderSettings.update(invalid),RangeError);
  assert.deepEqual(renderSettings.value,{samples:64,resolution:.5,bounces:2,traceMode:'scene',enabled:true});
  renderSettings.update({traceMode:'text'});
  assert.equal(seen.length,2);
  renderSettings.update({traceMode:'text'});
  assert.equal(seen.length,2);
  unsubscribe();
  renderSettings.update({samples:null,resolution:1,bounces:4,traceMode:'scene'});
  assert.equal(seen.length,2);
});


test('shared text geometry fits page coordinates and preserves semantic layout', () => {
  const font = new FontLoader().parse({ resolution: 1000, boundingBox: { yMin: -200, yMax: 800 }, underlineThickness: 50, glyphs: {
    '?': { ha: 700, o: 'm 0 -200 l 700 -200 l 700 800 l 0 800 l 0 -200' },
    ' ': { ha: 350 },
  } });
  for (const width of [180, 880]) {
    const rowContent = { rows: [
      [{ text: 'Free for everyone', color: 0x73c991 }],
      [{ text: 'World supercomputer', color: 0xff66cc }],
    ], maxSize: 200, fill: 1 };
    const paragraphContent = { paragraphs: [
      { spans: [{ text: 'App maker', color: 0xffffff }], size: 22, gapAfter: 8 },
      { spans: [{ text: 'Terms and Privacy', color: 0xffffff, href: '/privacy-policy' }], size: 16 },
    ], inset: 12 };
    for (const content of [rowContent, paragraphContent]) {
      const { group, height, layout } = buildTextGroup(font, content, width);
      const bounds = new THREE.Box3().setFromObject(group);
      assert.ok(bounds.min.x >= -width / 2 - .001);
      assert.ok(bounds.max.x <= width / 2 + .001);
      assert.ok(bounds.max.y <= .001);
      assert.ok(bounds.min.y >= -height - .001);
      assert.ok(Math.abs(bounds.max.z - 20) < .001);
      if (content.paragraphs) assert.deepEqual(layout, layoutDocument(font, content.paragraphs, width, 12));
      group.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    }
  }
});


test('separate scene settings isolate tracing enablement and reset', async () => {
  const {createRenderSettings} = await import('../runtime/hero/render-settings.mjs');
  const bricks = createRenderSettings({enabled:false});
  const content = createRenderSettings();
  let changes = 0;
  content.subscribe(() => changes++);
  bricks.update({enabled:true, bounces:8});
  assert.equal(content.value.enabled,true);
  assert.equal(content.value.bounces,4);
  assert.equal(changes,0);
  content.update({enabled:false});
  assert.equal(bricks.value.enabled,true);
  assert.equal(changes,1);
  assert.throws(() => content.update({enabled:'true'}),RangeError);
  assert.equal(content.value.enabled,false);
});

test('white text can retain white luminance without changing colored accents', () => {
  const font = new FontLoader().parse({ resolution:1000, boundingBox:{yMin:0,yMax:800}, underlineThickness:50, glyphs:{
    '?':{ha:700,o:'m 0 0 l 700 0 l 700 800 l 0 800 l 0 0'},
  }});
  const {group} = buildTextGroup(font, {preserveWhite:true,rows:[[{text:'A',color:0xffffff},{text:'B',color:0xff66cc}]]},300);
  const materials=[];
  group.traverse(object => {if(object.isMesh)materials.push(object.material);});
  assert.equal(materials[0].emissive.getHex(),0xffffff);
  assert.equal(materials[0].toneMapped,false);
  assert.equal(materials[1].emissive.getHex(),0);
  assert.equal(materials[1].color.getHex(),0xff66cc);
  group.traverse(object => {object.geometry?.dispose();object.material?.dispose();});
});
