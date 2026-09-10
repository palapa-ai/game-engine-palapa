import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadAssets, formatRemaining } from '../runtime/hero/loading.mjs';

const response = chunks => new Response(new ReadableStream({
  start(controller) {
    chunks.forEach(size => controller.enqueue(new Uint8Array(size)));
    controller.close();
  },
}));

test('remaining bytes follow actual response chunks and reach zero after all streams finish', async t => {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async url => response(url === 'a' ? [200000, 100000] : [300000, 400000]));
  assert.equal(await downloadAssets([{url:'a',bytes:300000},{url:'b',bytes:700000}], value => seen.push(value)), true);
  assert.equal(seen[0].remaining, 1000000);
  assert.equal(seen.at(-1).remaining, 0);
  assert.equal(seen.filter(value => value.remaining === 0).length, 1);
  assert.ok(seen.some(value => value.remaining === 800000));
  seen.forEach((value, index) => {
    assert.equal(value.total, 1000000);
    if (index) assert.ok(value.remaining <= seen[index - 1].remaining);
  });
});

test('zero is withheld until the response stream closes', async t => {
  let controller;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({start(value) { controller = value; }})));
  const seen = [];
  const download = downloadAssets([{url:'a',bytes:10}], value => seen.push(value));
  await new Promise(setImmediate);
  controller.enqueue(new Uint8Array(10));
  await new Promise(setImmediate);
  assert.ok(seen.every(value => value.remaining > 0));
  controller.close();
  await download;
  assert.equal(seen.at(-1).remaining, 0);
});

test('incorrect or unmeasurable responses drop the numeric counter instead of showing a false zero', async t => {
  for (const reply of [() => response([9]), () => response([10, 1]), () => ({ok:true,body:null,arrayBuffer:async () => new ArrayBuffer(10)})]) {
    t.mock.method(globalThis, 'fetch', async () => reply());
    const seen = [];
    assert.equal(await downloadAssets([{url:'a',bytes:10}], value => seen.push(value)), false);
    assert.equal(seen.at(-1), null);
    assert.ok(seen.every(value => value === null || value.remaining > 0));
    t.mock.restoreAll();
  }
});

test('failed downloads abort the batch and remove numeric progress', async t => {
  const signals = [], seen = [];
  t.mock.method(globalThis, 'fetch', async (url, {signal}) => {
    signals.push(signal);
    if (url === 'bad') return new Response('', {status:503});
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once:true}));
  });
  await assert.rejects(downloadAssets([{url:'bad',bytes:10},{url:'waiting',bytes:20}], value => seen.push(value)), /503/);
  assert.ok(signals.every(signal => signal.aborted));
  assert.equal(seen.at(-1), null);
  assert.ok(seen.every(value => value === null || value.remaining > 0));
});

test('invalid manifests fail before fetching and small remaining amounts never round down to zero', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected fetch'); });
  await assert.rejects(downloadAssets([{bytes:-1}], () => {}), /Invalid/);
  await assert.rejects(downloadAssets([{bytes:Number.MAX_SAFE_INTEGER},{bytes:1}], () => {}), /Invalid/);
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(formatRemaining(0), '0 MB');
  assert.equal(formatRemaining(1), '0.1 MB');
  assert.equal(formatRemaining(1700000), '1.7 MB');
});
