import test from 'node:test';
import assert from 'node:assert/strict';
import { deferSurface } from '../runtime/hero/defer-surface.mjs';

test('visible surfaces mount first, offscreen surfaces mount slowly, and hidden or disposed pages do no work', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const oldDocument = globalThis.document, oldObserver = globalThis.IntersectionObserver;
  globalThis.document = new EventTarget();
  document.hidden = false;
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(element) { element.visibility = visible => this.callback([{isIntersecting:visible}]); }
    disconnect() {}
  };
  const mounted = [], disposed = [], handles = [];
  const add = name => {
    const element = {dataset:{}};
    handles.push(deferSurface(element, async () => {
      mounted.push(name);
      return {dispose: () => disposed.push(name)};
    }));
    return element;
  };
  const advance = async ms => { t.mock.timers.tick(ms); await Promise.resolve(); await Promise.resolve(); };
  try {
    add('offscreen');
    add('visible').visibility(true);
    await advance(0);
    assert.deepEqual(mounted, ['visible']);
    await advance(499);
    assert.deepEqual(mounted, ['visible']);
    await advance(1);
    assert.deepEqual(mounted, ['visible', 'offscreen']);
    add('hidden');
    document.hidden = true;
    await advance(1000);
    assert.equal(mounted.length, 2);
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(500);
    assert.deepEqual(mounted, ['visible', 'offscreen', 'hidden']);
    add('cancelled');
    handles.at(-1).dispose();
    await advance(1000);
    assert.equal(mounted.includes('cancelled'), false);
  } finally {
    handles.forEach(handle => handle.dispose());
    globalThis.document = oldDocument;
    globalThis.IntersectionObserver = oldObserver;
  }
  assert.deepEqual(disposed.sort(), ['hidden','offscreen','visible']);
});
