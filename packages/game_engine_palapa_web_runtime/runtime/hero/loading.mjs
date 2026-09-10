export async function downloadAssets(assets, onProgress) {
  const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  if (!Number.isSafeInteger(total) || assets.some(asset => !Number.isSafeInteger(asset.bytes) || asset.bytes < 0)) {
    throw new Error('Invalid download manifest');
  }
  let received = 0, measurable = true, failed = false;
  const controller = new AbortController();
  const pending = [...assets];
  const report = (complete = false) => {
    if (failed) return;
    if (!measurable) onProgress(null);
    else if (received < total || complete) onProgress({ total, remaining: total - received });
  };
  report();
  const load = async () => {
    while (pending.length && !controller.signal.aborted) {
      const asset = pending.shift();
      const response = await fetch(asset.url, { cache: 'force-cache', signal: controller.signal });
      if (!response.ok) throw new Error(`Asset request failed: ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) {
        measurable = false; report();
        await response.arrayBuffer();
        continue;
      }
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          received += value.byteLength;
          if (bytes > asset.bytes || received > total) measurable = false;
          report();
        }
      } finally { reader.releaseLock(); }
      if (bytes !== asset.bytes) { measurable = false; report(); }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(4, assets.length) }, load));
  } catch (error) {
    failed = true;
    controller.abort();
    onProgress(null);
    throw error;
  }
  report(true);
  return measurable;
}

export function formatRemaining(bytes) {
  if (bytes === 0) return '0 MB';
  return `${(Math.ceil(bytes / 100000) / 10).toFixed(1)} MB`;
}
