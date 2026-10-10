/**
 * Normal maps from global elevation models (relief effect, src/render/relief.ts).
 *
 * Input: an equirectangular height grid (metres, north up, prime meridian at the centre). Output: an RGB map of
 * the same layout whose texels are the surface normal in the local east/north/up frame (x east, y north, z up),
 * encoded n·0.5 + 0.5 as linear data. Slopes are central differences over the output texel, with the metric
 * spacing of each row (R·cosφ·Δλ east, R·Δφ north), times an exaggeration factor so the relief reads on a globe.
 */

/** Box-filtered resampling of a height grid to `outW`×`outH` (area average: no aliasing when shrinking). */
export function resampleHeights(
  src: Float32Array,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
): Float32Array {
  const out = new Float32Array(outW * outH);
  const sx = srcW / outW;
  const sy = srcH / outH;
  for (let j = 0; j < outH; j++) {
    const y0 = j * sy;
    const y1 = (j + 1) * sy;
    for (let i = 0; i < outW; i++) {
      const x0 = i * sx;
      const x1 = (i + 1) * sx;
      let sum = 0;
      let weight = 0;
      for (let y = Math.floor(y0); y < Math.min(srcH, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.min(srcW, Math.ceil(x1)); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          sum += (src[y * srcW + x] ?? 0) * wx * wy;
          weight += wx * wy;
        }
      }
      out[j * outW + i] = weight > 0 ? sum / weight : 0;
    }
  }
  return out;
}

/**
 * Tangent-space normal map (RGB bytes) of a `w`×`h` height grid (metres) on a sphere of `radiusM`.
 * Longitudes wrap; the rows next to the poles use one-sided differences, and the east spacing is floored so
 * the polar rows do not get unbounded slopes from a vanishing cos φ.
 */
export function normalMap(
  heights: Float32Array,
  w: number,
  h: number,
  radiusM: number,
  exaggeration: number,
): Buffer {
  const out = Buffer.alloc(w * h * 3);
  const dPhi = Math.PI / h;
  const dLambda = (2 * Math.PI) / w;
  const at = (i: number, j: number): number => heights[j * w + (((i % w) + w) % w)] ?? 0;
  for (let j = 0; j < h; j++) {
    const lat = Math.PI / 2 - (j + 0.5) * dPhi;
    const dxM = radiusM * Math.max(Math.cos(lat), dPhi) * dLambda;
    const dyM = radiusM * dPhi;
    const jn = Math.max(0, j - 1);
    const js = Math.min(h - 1, j + 1);
    for (let i = 0; i < w; i++) {
      const dhdx = (at(i + 1, j) - at(i - 1, j)) / (2 * dxM);
      // Row 0 is north: northward slope is (north − south) over their distance.
      const dhdy = (at(i, jn) - at(i, js)) / ((js - jn) * dyM);
      const nx = -dhdx * exaggeration;
      const ny = -dhdy * exaggeration;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const o = (j * w + i) * 3;
      out[o] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

/** Rolls a grid horizontally so that longitude `centerLonDeg` (at the source centre) moves to the prime meridian. */
export function rollToPrimeMeridian(
  src: Float32Array,
  w: number,
  h: number,
  centerLonDeg: number,
): Float32Array {
  const shift = ((Math.round((centerLonDeg / 360) * w) % w) + w) % w;
  if (shift === 0) return src;
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) out[j * w + i] = src[j * w + ((i + shift) % w)] ?? 0;
  }
  return out;
}
