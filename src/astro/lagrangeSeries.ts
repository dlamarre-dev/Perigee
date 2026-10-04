/**
 * Two-body motion over a short time from a state vector, by the Lagrange f and g series (Taylor expansion of the
 * coefficients in r(t) = f·r0 + g·v0, to dt⁵). Closed form and branch-free, so the satellite vertex shader runs the
 * same formulas (src/render/SatellitePoints.ts mirrors `lagrangeSeries` and `blendWeight`); this module is the
 * tested reference.
 *
 * Unlike a straight line (linear extrapolation) or a cubic between two samples, it follows the orbit's curvature:
 * at ×10 000 the SGP4 samples are 10–25 minutes apart and a late sample means minutes of extrapolation, during
 * which a straight line leaves a low orbit by tens to hundreds of kilometres.
 *
 * Series (Bate, Mueller & White §4.5; Escobal): with u = μ/r³, p = (r·v)/r², q = v²/r² − u,
 *   f = 1 − ½u t² + ½up t³ + (3uq − 15up² + u²) t⁴/24 + (7up³ − 3upq − u²p) t⁵/8
 *   g = t − u t³/6 + ¼up t⁴ + (9uq − 45up² + u²) t⁵/120
 */
import type { StateVector } from './hermite';
import { add, scale, type Vec3 } from './vec3';

export interface LagrangeCoefficients {
  /** f − 1 (kept apart so the caller can add it to a camera-relative position without losing precision). */
  readonly fMinus1: number;
  readonly g: number;
}

/** Range of validity of the series, in units of the local angular rate: |dt| ≤ SERIES_LIMIT / ω. */
export const SERIES_LIMIT = 1.5;

/**
 * f − 1 and g after dtS seconds. |dtS| is clamped to the series' range of validity (SERIES_LIMIT / ω, with ω the
 * faster of √u and |v|/r, i.e. about a quarter of a circular orbit): beyond it the object stays at the edge
 * instead of the series diverging.
 */
export function lagrangeSeries(
  posKm: Vec3,
  velKmS: Vec3,
  dtS: number,
  muKm3S2: number,
): LagrangeCoefficients {
  const r2 = posKm[0] * posKm[0] + posKm[1] * posKm[1] + posKm[2] * posKm[2];
  const u = muKm3S2 / (r2 * Math.sqrt(r2));
  const p = (posKm[0] * velKmS[0] + posKm[1] * velKmS[1] + posKm[2] * velKmS[2]) / r2;
  const v2r2 = (velKmS[0] * velKmS[0] + velKmS[1] * velKmS[1] + velKmS[2] * velKmS[2]) / r2;
  const q = v2r2 - u;
  const limit = SERIES_LIMIT / Math.sqrt(Math.max(u, v2r2));
  const t = Math.max(-limit, Math.min(limit, dtS));
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const t5 = t4 * t;
  const fMinus1 =
    -0.5 * u * t2 +
    0.5 * u * p * t3 +
    ((3 * u * q - 15 * u * p * p + u * u) * t4) / 24 +
    ((7 * u * p * p * p - 3 * u * p * q - u * u * p) * t5) / 8;
  const g = t - (u * t3) / 6 + 0.25 * u * p * t4 + ((9 * u * q - 45 * u * p * p + u * u) * t5) / 120;
  return { fMinus1, g };
}

/** Position dtS seconds after a state, by the series. */
export function propagateSeries(state: StateVector, dtS: number, muKm3S2: number): Vec3 {
  const { fMinus1, g } = lagrangeSeries(state.posKm, state.velKmS, dtS, muKm3S2);
  return add(add(state.posKm, scale(state.posKm, fMinus1)), scale(state.velKmS, g));
}

/** Between two samples, each one's series covers its own side; they are blended over this middle stretch. */
export const BLEND_START = 0.3;
export const BLEND_END = 0.7;

/**
 * Weight of the later sample at normalised time tau ∈ [0, 1] between two samples: 0 then a smoothstep over
 * [BLEND_START, BLEND_END] then 1. Each series is only used up to 70 % of the span from its sample (its error
 * grows like dt⁶), and the motion stays C¹ (exact positions and velocities at the samples).
 */
export function blendWeight(tau: number): number {
  const t = Math.max(0, Math.min(1, (tau - BLEND_START) / (BLEND_END - BLEND_START)));
  return t * t * (3 - 2 * t);
}

/**
 * Position at `tS` between samples A (time aS) and B (time bS), or beyond them: the series from each sample,
 * blended. Outside [A, B] only the nearest sample is used.
 */
export function twoBodyBetween(
  a: StateVector,
  aS: number,
  b: StateVector,
  bS: number,
  tS: number,
  muKm3S2: number,
): Vec3 {
  const span = bS - aS;
  const tau = span > 0 ? (tS - aS) / span : 2;
  if (tau <= 0) return propagateSeries(a, tS - aS, muKm3S2);
  if (tau >= 1) return propagateSeries(b, tS - bS, muKm3S2);
  const w = blendWeight(tau);
  return add(
    scale(propagateSeries(a, tS - aS, muKm3S2), 1 - w),
    scale(propagateSeries(b, tS - bS, muKm3S2), w),
  );
}
