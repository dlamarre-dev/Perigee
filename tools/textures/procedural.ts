/**
 * Procedural equirectangular maps for bodies without a public-domain global map (Venus cloud tops, Saturn,
 * Uranus, Neptune, unresolved dwarf planets). These are artistic renderings: latitude bands whose colours are
 * estimated from public-domain true-colour images (sources in DATA_SOURCES.md), plus low-amplitude noise.
 * Deterministic (seeded) so reruns produce identical files.
 */

export type Rgb = readonly [number, number, number];

export interface BandedStyle {
  /** Colour stops by planetocentric latitude (degrees, ascending from −90 to +90). */
  readonly stops: readonly (readonly [number, Rgb])[];
  /** Relative amplitude of the fine turbulent noise (0 = smooth). */
  readonly noise: number;
  /** Horizontal stretch of the noise (large = streaky, zonal flow). */
  readonly stretch: number;
  readonly seed: number;
}

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374_761_393 + y * 668_265_263 + seed * 2_147_483_647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  return ((h ^ (h >>> 16)) >>> 0) / 4_294_967_296;
}

/** Smooth value noise, periodic in x with period `periodX` cells (the map wraps around in longitude). */
function valueNoise(x: number, y: number, periodX: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const wrap = (i: number): number => ((i % periodX) + periodX) % periodX;
  const a = hash(wrap(x0), y0, seed);
  const b = hash(wrap(x0 + 1), y0, seed);
  const c = hash(wrap(x0), y0 + 1, seed);
  const d = hash(wrap(x0 + 1), y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, periodX: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 5; o++) {
    sum += amp * (valueNoise(x * freq, y * freq, periodX * freq, seed + o) - 0.5);
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}

function bandColor(stops: BandedStyle['stops'], latDeg: number): Rgb {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) throw new Error('empty colour stops');
  if (latDeg <= first[0]) return first[1];
  for (let i = 1; i < stops.length; i++) {
    const hi = stops[i];
    const lo = stops[i - 1];
    if (!hi || !lo) continue;
    if (latDeg <= hi[0]) {
      const t = (latDeg - lo[0]) / (hi[0] - lo[0]);
      const s = t * t * (3 - 2 * t);
      return [
        lo[1][0] + (hi[1][0] - lo[1][0]) * s,
        lo[1][1] + (hi[1][1] - lo[1][1]) * s,
        lo[1][2] + (hi[1][2] - lo[1][2]) * s,
      ];
    }
  }
  return last[1];
}

/** Raw RGB bytes of a width × width/2 equirectangular map. */
export function bandedMap(width: number, style: BandedStyle): Buffer {
  const height = width / 2;
  const out = Buffer.alloc(width * height * 3);
  const cellsX = 24;
  for (let y = 0; y < height; y++) {
    const latDeg = 90 - ((y + 0.5) / height) * 180;
    for (let x = 0; x < width; x++) {
      // Noise also perturbs latitude slightly, so band edges wave instead of being ruler-straight.
      const nx = (x / width) * cellsX;
      const ny = (y / height) * cellsX * 0.5 * style.stretch;
      const warp = fbm(nx, ny, cellsX, style.seed) * 6;
      const base = bandColor(style.stops, latDeg + warp * style.noise * 4);
      const grain = 1 + fbm(nx * 3, ny * 3, cellsX * 3, style.seed + 17) * style.noise;
      const i = (y * width + x) * 3;
      out[i] = Math.max(0, Math.min(255, Math.round(base[0] * grain)));
      out[i + 1] = Math.max(0, Math.min(255, Math.round(base[1] * grain)));
      out[i + 2] = Math.max(0, Math.min(255, Math.round(base[2] * grain)));
    }
  }
  return out;
}

const uniform = (c: Rgb): BandedStyle['stops'] => [
  [-90, c],
  [90, c],
];

/** Styles; colours are estimates (see DATA_SOURCES.md). */
export const PROCEDURAL: Record<string, BandedStyle> = {
  // Cloud tops in visible light are nearly featureless pale yellow-cream.
  venus: {
    stops: [
      [-90, [214, 200, 164]],
      [-40, [232, 219, 182]],
      [0, [236, 224, 188]],
      [40, [232, 219, 182]],
      [90, [214, 200, 164]],
    ],
    noise: 0.05,
    stretch: 3,
    seed: 2,
  },
  // Pale-gold zones and belts, greyer-blue north polar region (after Cassini PIA06193).
  saturn: {
    stops: [
      [-90, [150, 140, 112]],
      [-70, [186, 170, 132]],
      [-50, [206, 186, 142]],
      [-35, [222, 204, 160]],
      [-22, [200, 176, 128]],
      [-12, [226, 208, 164]],
      [0, [234, 218, 176]],
      [12, [226, 208, 164]],
      [22, [198, 172, 124]],
      [35, [220, 200, 156]],
      [50, [204, 184, 140]],
      [70, [172, 168, 150]],
      [90, [140, 150, 150]],
    ],
    noise: 0.06,
    stretch: 6,
    seed: 6,
  },
  // Pale greenish-cyan with faint polar brightening (Irwin et al. 2024 true-colour reprocessing).
  uranus: {
    stops: [
      [-90, [206, 236, 236]],
      [-60, [193, 229, 231]],
      [0, [186, 223, 228]],
      [60, [193, 229, 231]],
      [90, [206, 236, 236]],
    ],
    noise: 0.02,
    stretch: 6,
    seed: 7,
  },
  // Pale blue, slightly bluer than Uranus (same source).
  neptune: {
    stops: [
      [-90, [178, 206, 228]],
      [-45, [164, 198, 226]],
      [-20, [172, 204, 230]],
      [0, [168, 202, 228]],
      [30, [164, 198, 226]],
      [90, [178, 206, 228]],
    ],
    noise: 0.04,
    stretch: 5,
    seed: 8,
  },
  eris: { stops: uniform([230, 228, 223]), noise: 0.05, stretch: 1, seed: 11 },
  haumea: { stops: uniform([232, 230, 226]), noise: 0.05, stretch: 1, seed: 12 },
  makemake: { stops: uniform([216, 184, 154]), noise: 0.07, stretch: 1, seed: 13 },
};
