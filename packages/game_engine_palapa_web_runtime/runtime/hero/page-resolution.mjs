// Full-page color/depth caches share this budget. Keep native screen pixels
// when they fit, without allowing high-DPI long pages to allocate unbounded GPU targets.
export const PAGE_PIXEL_BUDGET = 6000000;

export function pageBufferSize(width, height, { pixelRatio = 1, resolution = 1, maxTextureSize = Infinity } = {}) {
  const scale = Math.min(pixelRatio * resolution,
    Math.sqrt(PAGE_PIXEL_BUDGET / (width * height)), maxTextureSize / Math.max(width, height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
