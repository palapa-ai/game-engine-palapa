// Every submitted band must contain at least one physical target row.
export function scanlineRows(divisions, height = Infinity) {
  if (!Number.isInteger(divisions) || divisions < 1 || !(height >= 1)) {
    throw RangeError('Scanline divisions and target height must be positive');
  }
  return Math.min(divisions ** 2, Math.floor(height));
}

export function scanlineCoverage(samples, height, rows) {
  if (!(samples > 0) || !(height > 0) || !(rows > 0)) return 0;
  if (samples >= 1) return 1;
  const completed = Math.min(rows, Math.floor(samples * rows + 1e-8));
  return (height - Math.floor(height * (rows - completed) / rows)) / height;
}
