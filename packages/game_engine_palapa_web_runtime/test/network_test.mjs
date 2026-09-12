import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkBudget, networkProfile, networkProfiles } from '../runtime/debug/network.mjs';

test('parallel downloads share a connection budget, with dial-up slower than 3G', async () => {
  const waits = [];
  const budget = new NetworkBudget({ now: () => 0, sleep: async ms => waits.push(ms), random: () => 0.5 });
  await Promise.all([budget.chunk(7000, networkProfiles.dialup), budget.chunk(7000, networkProfiles.dialup)]);
  assert.deepEqual(waits, [1000, 2000]);
  const fast = new NetworkBudget({ now: () => 0, sleep: async ms => waits.push(ms), random: () => 0.5 });
  await fast.chunk(7000, networkProfiles['3g']);
  assert.ok(waits.at(-1) < 100);
});

test('intermittent profile can stall and fail, while broadband and unknown profiles pass through', async () => {
  const waits = [];
  const budget = new NetworkBudget({ now: () => 0, sleep: async ms => waits.push(ms), random: () => 0 });
  await assert.rejects(budget.request(networkProfiles.intermittent), /interruption/);
  await budget.chunk(4096, networkProfiles.intermittent);
  assert.ok(waits.at(-1) > 1500);
  assert.equal(networkProfile('https://site.test/debug?network=3g'), '3g');
  assert.equal(networkProfile('https://site.test/debug?network=constructor'), 'fast');
  assert.equal(networkProfile('https://site.test/debug'), 'fast');
});

test('debug worker leaves normal pages alone and streams all bytes under simulated 3G', async () => {
  const globals = { self: globalThis.self, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout };
  const handlers = {}, bytes = new Uint8Array(10000).map((_, i) => i % 255);
  let page = 'https://site.test/debug?network=3g', fetched = 0;
  try {
    globalThis.self = { addEventListener: (type, fn) => { handlers[type] = fn; }, clients: { get: async () => ({ id: 'page', url: page }) } };
    globalThis.fetch = async () => { fetched++; return new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) } }); };
    globalThis.setTimeout = fn => { queueMicrotask(fn); return 0; };
    await import('../runtime/debug/network-worker.mjs');
    let response;
    const request = new Request('https://site.test/debug-assets/version/model.bin');
    handlers.fetch({ request, clientId: 'page', respondWith: value => { response = value; } });
    const shaped = await response;
    assert.equal(shaped.headers.get('cache-control'), 'no-store');
    assert.equal(shaped.headers.get('content-length'), null);
    assert.deepEqual(new Uint8Array(await shaped.arrayBuffer()), bytes);
    page = 'https://site.test/';
    handlers.fetch({ request, clientId: 'page', respondWith: value => { response = value; } });
    const normal = await response;
    assert.equal(normal.headers.get('cache-control'), null);
    assert.equal(fetched, 2);
    response = null;
    handlers.fetch({ request: new Request('https://site.test/debug-assets/version/boot.mjs'), respondWith: value => { response = value; } });
    assert.equal(response, null, 'controls remain available to recover from an interrupted download');
  } finally {
    Object.assign(globalThis, globals);
  }
});
