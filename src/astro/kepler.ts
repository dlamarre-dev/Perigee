/**
 * Two-body Keplerian propagation (universal variables, Stumpff functions) and osculating elements.
 * Used to extrapolate beyond an ephemeris window and for published mean elements (CLAUDE.md §5.2–5.3).
 * Pure, Float64. Reference: Curtis, "Orbital Mechanics for Engineering Students", algorithms 3.3–3.4, 4.2.
 */
import { add, cross, dot, length, scale, sub } from './vec3';
import type { StateVector } from './hermite';

/** Gravitational parameters (km³/s²). Moon and Mars: JPL DE440; Earth: IERS. */
export const GM_KM3_S2 = {
  earth: 398_600.435_436,
  moon: 4902.800_118,
  mars: 42_828.375_214,
  sun: 132_712_440_041.279_42,
} as const;

function stumpffC(z: number): number {
  if (z > 1e-8) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-8) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2 - z / 24 + (z * z) / 720;
}

function stumpffS(z: number): number {
  if (z > 1e-8) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-8) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

/** Propagates a state by dtS seconds under central gravity muKm3S2. */
export function propagateKepler(state: StateVector, dtS: number, muKm3S2: number): StateVector {
  if (dtS === 0) return state;
  const r0 = state.posKm;
  const v0 = state.velKmS;
  const r0n = length(r0);
  const v0n = length(v0);
  const vr0 = dot(r0, v0) / r0n;
  const alpha = 2 / r0n - (v0n * v0n) / muKm3S2; // 1/a
  const sqrtMu = Math.sqrt(muKm3S2);

  // Newton iteration on the universal anomaly χ.
  let chi = sqrtMu * Math.abs(alpha) * dtS;
  if (!Number.isFinite(chi) || chi === 0) chi = (sqrtMu * dtS) / r0n;
  for (let i = 0; i < 60; i++) {
    const z = alpha * chi * chi;
    const c = stumpffC(z);
    const s = stumpffS(z);
    const f =
      ((r0n * vr0) / sqrtMu) * chi * chi * c +
      (1 - alpha * r0n) * chi * chi * chi * s +
      r0n * chi -
      sqrtMu * dtS;
    const df = ((r0n * vr0) / sqrtMu) * chi * (1 - z * s) + (1 - alpha * r0n) * chi * chi * c + r0n;
    const step = f / df;
    chi -= step;
    if (Math.abs(step) < 1e-10 * Math.max(1, Math.abs(chi))) break;
  }

  const z = alpha * chi * chi;
  const c = stumpffC(z);
  const s = stumpffS(z);
  const fLag = 1 - ((chi * chi) / r0n) * c;
  const gLag = dtS - (1 / sqrtMu) * chi * chi * chi * s;
  const r = add(scale(r0, fLag), scale(v0, gLag));
  const rn = length(r);
  const fDot = (sqrtMu / (rn * r0n)) * (alpha * chi * chi * chi * s - chi);
  const gDot = 1 - ((chi * chi) / rn) * c;
  return { posKm: r, velKmS: add(scale(r0, fDot), scale(v0, gDot)) };
}

export interface OsculatingElements {
  readonly semiMajorAxisKm: number;
  readonly eccentricity: number;
  /** Relative to the reference plane of the input frame. */
  readonly inclinationRad: number;
  /** Undefined for unbound orbits. */
  readonly periodS: number | undefined;
  readonly periapsisRadiusKm: number;
  readonly apoapsisRadiusKm: number | undefined;
}

export function osculatingElements(state: StateVector, muKm3S2: number): OsculatingElements {
  const r = state.posKm;
  const v = state.velKmS;
  const rn = length(r);
  const vn = length(v);
  const h = cross(r, v);
  const hn = length(h);
  const eVec = sub(scale(r, (vn * vn) / muKm3S2 - 1 / rn), scale(v, dot(r, v) / muKm3S2));
  const e = length(eVec);
  const energy = (vn * vn) / 2 - muKm3S2 / rn;
  const a = -muKm3S2 / (2 * energy);
  const bound = energy < 0;
  return {
    semiMajorAxisKm: a,
    eccentricity: e,
    inclinationRad: Math.acos(Math.max(-1, Math.min(1, (h[2] ?? 0) / hn))),
    periodS: bound ? 2 * Math.PI * Math.sqrt((a * a * a) / muKm3S2) : undefined,
    periapsisRadiusKm: (hn * hn) / muKm3S2 / (1 + e),
    apoapsisRadiusKm: bound ? a * (1 + e) : undefined,
  };
}
