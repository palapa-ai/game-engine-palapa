import { NetworkBudget, networkProfile, networkProfiles } from './network.mjs';
const budgets = new Map();
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  // Keep the debug controls and reload path usable even on a broken connection.
  if (request.method !== 'GET' || request.mode === 'navigate' ||
      /\/(boot\.mjs|legal\.mjs|site\.css|loading\.mjs|network(?:-control|-worker)?\.mjs)$/.test(url.pathname)) return;
  event.respondWith((async () => {
    const client = await self.clients.get(event.clientId);
    if (!client || !/^\/debug\/?$/.test(new URL(client.url).pathname)) return fetch(request);
    const profile = networkProfiles[networkProfile(client.url)];
    if (profile === networkProfiles.fast) return fetch(request, { cache: 'no-store' });
    let budget = budgets.get(client.id);
    if (!budget) { budget = new NetworkBudget(); budgets.set(client.id, budget); }
    await budget.request(profile);
    const response = await fetch(request, { cache: 'no-store' });
    if (!response.body || !response.ok || response.type === 'opaque') return response;
    const reader = response.body.getReader();
    let pending, offset = 0;
    const body = new ReadableStream({
      async pull(controller) {
        try {
          if (!pending || offset === pending.length) {
            const next = await reader.read();
            if (next.done) { controller.close(); return; }
            pending = next.value; offset = 0;
          }
          const end = Math.min(pending.length, offset + 4096);
          const chunk = pending.subarray(offset, end); offset = end;
          await budget.chunk(chunk.byteLength, profile);
          controller.enqueue(chunk);
        } catch (error) { controller.error(error); await reader.cancel(error); }
      },
      cancel(reason) { return reader.cancel(reason); },
    });
    const headers = new Headers(response.headers);
    headers.delete('content-length'); headers.delete('content-encoding');
    headers.set('cache-control', 'no-store');
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  })());
});
self.addEventListener('message', event => {
  if (event.data === 'clear-network-budget') budgets.delete(event.source?.id);
});
