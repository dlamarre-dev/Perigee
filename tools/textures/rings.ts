/**
 * Radial ring textures (RGBA strip, u = radius from innerKm to outerKm).
 * RGB = lit-side colour, A = sqrt(normal optical depth / TAU_SCALE), decoded in the ring shader, which turns it
 * into opacity for the actual viewing angle: alpha = 1 − exp(−τ / |cos θ|).
 *
 * Saturn: Voyager 2 ISS radial I/F profile (PDS Rings Node VG_2810, Showalter & Gordon) for brightness and the
 * Voyager 2 PPS δ Sco occultation (VG_2801, Esposito et al.) for optical depth, both at 10 km resolution.
 * Uranus: ring radii and widths from the NASA Uranian Rings Fact Sheet; dark (albedo ≈ 0.02) narrow rings.
 * Neptune: NASA Neptunian Rings Fact Sheet and PDS Rings Node tables; faint, dusty, reddish rings.
 */

import {
  RING_TAU_SCALE as TAU_SCALE,
  SATURN_RINGS,
  URANUS_RINGS as URANUS_EXTENT,
  NEPTUNE_RINGS as NEPTUNE_EXTENT,
} from '../../src/astro/planets';

export interface RingProfile {
  readonly innerKm: number;
  readonly outerKm: number;
  readonly width: number;
  /** Raw RGBA bytes, `width` × 1. */
  readonly rgba: Buffer;
}

/** Parses "radius, value, …" CSV rows into [radiusKm, column] pairs. */
export function parseTable(text: string, column: number): [number, number][] {
  const rows: [number, number][] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(',').map((s) => Number(s.trim()));
    const r = parts[0];
    const v = parts[column];
    if (r === undefined || v === undefined || !Number.isFinite(r) || !Number.isFinite(v)) continue;
    rows.push([r, v]);
  }
  return rows;
}

/** Mean of samples within [r0, r1), linear interpolation when the bin holds none. */
function binMean(rows: readonly [number, number][], r0: number, r1: number): number {
  let sum = 0;
  let n = 0;
  for (const [r, v] of rows) {
    if (r >= r0 && r < r1) {
      sum += v;
      n++;
    }
  }
  if (n > 0) return sum / n;
  const mid = (r0 + r1) / 2;
  let lo: [number, number] | undefined;
  let hi: [number, number] | undefined;
  for (const row of rows) {
    if (row[0] <= mid) lo = row;
    else if (!hi) hi = row;
  }
  if (!lo) return hi?.[1] ?? 0;
  if (!hi) return lo[1];
  return lo[1] + ((hi[1] - lo[1]) * (mid - lo[0])) / (hi[0] - lo[0]);
}

const encodeTau = (tau: number): number =>
  Math.round(Math.sqrt(Math.min(Math.max(tau, 0), TAU_SCALE) / TAU_SCALE) * 255);

export function saturnRings(brightnessCsv: string, tauCsv: string, width = 2048): RingProfile {
  const { innerKm, outerKm } = SATURN_RINGS;
  const iof = parseTable(brightnessCsv, 1);
  const tau = parseTable(tauCsv, 3);
  const step = (outerKm - innerKm) / width;
  const values: number[] = [];
  for (let i = 0; i < width; i++)
    values.push(Math.max(0, binMean(iof, innerKm + i * step, innerKm + (i + 1) * step)));
  const maxIof = Math.max(...values);
  const rgba = Buffer.alloc(width * 4);
  // Warm beige, the C ring and Cassini Division greyer (Cassini true-colour mosaic PIA06193).
  const warm = [216, 200, 168] as const;
  const grey = [170, 164, 152] as const;
  for (let i = 0; i < width; i++) {
    const r = innerKm + (i + 0.5) * step;
    const b = Math.pow((values[i] ?? 0) / maxIof, 0.8);
    const warmth = r < 91_975 ? 0.2 : r > 117_507 && r < 122_340 ? 0.4 : 1;
    const t = Math.min(binMean(tau, r - step / 2, r + step / 2), 3);
    rgba[i * 4] = Math.round((grey[0] + (warm[0] - grey[0]) * warmth) * b);
    rgba[i * 4 + 1] = Math.round((grey[1] + (warm[1] - grey[1]) * warmth) * b);
    rgba[i * 4 + 2] = Math.round((grey[2] + (warm[2] - grey[2]) * warmth) * b);
    rgba[i * 4 + 3] = encodeTau(t);
  }
  return { innerKm, outerKm, width, rgba };
}

/** [radius km, width km, optical depth] (NASA Uranian Rings Fact Sheet; widths are mid-range values). */
const URANUS_RINGS: readonly (readonly [number, number, number])[] = [
  [41_837, 1.5, 0.3],
  [42_234, 2, 0.5],
  [42_571, 2, 0.3],
  [44_718, 7, 0.4],
  [45_661, 8, 0.3],
  [47_176, 1.6, 0.4],
  [47_627, 2.5, 1.2],
  [48_300, 5, 0.4],
  [50_024, 2, 0.1],
  [51_149, 58, 1.2],
];

export function uranusRings(width = 1024): RingProfile {
  const { innerKm, outerKm } = URANUS_EXTENT;
  const step = (outerKm - innerKm) / width;
  const rgba = Buffer.alloc(width * 4);
  for (let i = 0; i < width; i++) {
    const r0 = innerKm + i * step;
    const r1 = r0 + step;
    // Coverage-weighted optical depth: sub-pixel rings keep their integrated opacity.
    let tau = 0;
    for (const [radius, w, t] of URANUS_RINGS) {
      const overlap = Math.max(0, Math.min(r1, radius + w / 2) - Math.max(r0, radius - w / 2));
      tau += (t * overlap) / step;
    }
    // Rendered a little stronger than physical so the rings remain visible at all (they are ~10 km wide).
    const visible = Math.min(1.5, tau * 3 + (tau > 0 ? 0.25 : 0));
    rgba[i * 4] = 92;
    rgba[i * 4 + 1] = 94;
    rgba[i * 4 + 2] = 98;
    rgba[i * 4 + 3] = encodeTau(visible);
  }
  return { innerKm, outerKm, width, rgba };
}

/**
 * [radius km, width km, optical depth]: Galle, Le Verrier, Lassell, Adams (NASA Neptunian Rings Fact Sheet; Le
 * Verrier's depth between NASA's 0.01 and PDS's 0.003, Adams at NASA's lower bound). Arago has no published
 * depth, and the Adams arcs (τ ≈ 0.1 over ~40° of longitude) would need an azimuthal map: both left out.
 */
const NEPTUNE_RINGS: readonly (readonly [number, number, number])[] = [
  [41_900, 2_000, 1e-4],
  [53_200, 100, 0.005],
  [55_200, 4_000, 1e-4],
  [62_933, 15, 0.01],
];

export function neptuneRings(width = 1024): RingProfile {
  const { innerKm, outerKm } = NEPTUNE_EXTENT;
  const step = (outerKm - innerKm) / width;
  const rgba = Buffer.alloc(width * 4);
  for (let i = 0; i < width; i++) {
    const r0 = innerKm + i * step;
    const r1 = r0 + step;
    let tau = 0;
    for (const [radius, w, t] of NEPTUNE_RINGS) {
      const overlap = Math.max(0, Math.min(r1, radius + w / 2) - Math.max(r0, radius - w / 2));
      tau += (t * overlap) / step;
    }
    // Strengthened (×60) so the narrow Adams and Le Verrier rings show as thin lines, about as visible as
    // Uranus' rings; the broad dusty Galle and Lassell rings stay a faint haze.
    const visible = Math.min(1.5, tau * 60 + (tau > 0 ? 0.03 : 0));
    rgba[i * 4] = 104;
    rgba[i * 4 + 1] = 94;
    rgba[i * 4 + 2] = 88;
    rgba[i * 4 + 3] = encodeTau(visible);
  }
  return { innerKm, outerKm, width, rgba };
}
