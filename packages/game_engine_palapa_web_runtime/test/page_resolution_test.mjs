import assert from 'node:assert/strict';
import test from 'node:test';
import { pageBufferSize, PAGE_PIXEL_BUDGET } from '../runtime/hero/page-resolution.mjs';

test('desktop rendering keeps native pixels without unnecessary supersampling', () => {
  assert.deepEqual(pageBufferSize(1920, 1080, { pixelRatio: 1, maxTextureSize: 16384 }),
    { width: 1920, height: 1080 });
});

test('high-DPI pages use native resolution when it fits the expanded budget', () => {
  assert.deepEqual(pageBufferSize(1280, 900, { pixelRatio: 2, maxTextureSize: 16384 }),
    { width: 2560, height: 1800 });
});

test('full desktop pages gain detail while remaining within six million pixels', () => {
  const size = pageBufferSize(1440, 3000, { pixelRatio: 2, maxTextureSize: 16384 });
  assert.deepEqual(size, { width: 1697, height: 3535 });
  assert.ok(size.width > 1440, 'the previous three-million-pixel limit undersampled CSS pixels');
  assert.ok(size.width * size.height <= PAGE_PIXEL_BUDGET);
  const fourK = pageBufferSize(3840, 2160, { pixelRatio: 2, maxTextureSize: 16384 });
  assert.deepEqual(fourK, { width: 3265, height: 1837 });
  assert.ok(fourK.width * fourK.height <= PAGE_PIXEL_BUDGET);
});

test('long narrow pages respect both the pixel budget and the hardware dimension limit', () => {
  assert.deepEqual(pageBufferSize(390, 8200, { pixelRatio: 3, maxTextureSize: 8192 }),
    { width: 389, height: 8192 });
  const largerDevice = pageBufferSize(390, 8200, { pixelRatio: 3, maxTextureSize: 16384 });
  assert.deepEqual(largerDevice, { width: 534, height: 11231 });
  assert.ok(largerDevice.width * largerDevice.height <= PAGE_PIXEL_BUDGET);
});

test('selected lower resolution still reduces GPU work and tiny buffers stay valid', () => {
  assert.deepEqual(pageBufferSize(1280, 900, { pixelRatio: 2, resolution: 0.5, maxTextureSize: 16384 }),
    { width: 1280, height: 900 });
  assert.deepEqual(pageBufferSize(1, 1, { pixelRatio: 1, resolution: 0.25, maxTextureSize: 4096 }),
    { width: 1, height: 1 });
});
