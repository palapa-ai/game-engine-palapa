export function scanlineCoverage(samples, height, rows) {
  if (!(samples > 0) || !(height > 0) || !(rows > 0)) return 0;
  if (samples >= 1) return 1;
  const completed = Math.min(rows, Math.floor(samples * rows + 1e-8));
  return (height - Math.floor(height * (rows - completed) / rows)) / height;
}
