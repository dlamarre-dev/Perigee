/**
 * Comets and asteroids (solar view): their osculating conic drawn from a Horizons state, perihelion passages and the
 * estimated brightness. Positions themselves come from Horizons vectors (EphemerisTrack), like the probes. Pure,
 * Float64.
 */
import { cross, dot, length, scale, sub } from './vec3';
import type { StateVector } from './hermite';
import type { Vec3 } from './vec3';

/** Open orbits are drawn out to this distance from the Sun (km, 60 au), well before their asymptotes. */
export const OPEN_ORBIT_MAX_KM = 60 * 149_597_870.7;

interface Conic {
  /** Semi-latus rectum p = h²/µ (km). */
  readonly pKm: number;
  readonly e: number;
  /** Perifocal axes: P̂ towards perihelion, Q̂ = ĥ × P̂. */
  readonly pHat: Vec3;
  readonly qHat: Vec3;
  /** Current true anomaly (rad). */
  readonly nu0: number;
}

function conicOf(state: StateVector, muKm3S2: number): Conic {
  const r = state.posKm;
  const v = state.velKmS;
  const rn = length(r);
  const vn = length(v);
  const h = cross(r, v);
  const eVec = sub(scale(r, (vn * vn) / muKm3S2 - 1 / rn), scale(v, dot(r, v) / muKm3S2));
  const e = length(eVec);
  const pHat = e > 1e-9 ? scale(eVec, 1 / e) : scale(r, 1 / rn);
  const qHat = scale(cross(h, pHat), 1 / length(h));
  const hn = length(h);
  return { pKm: (hn * hn) / muKm3S2, e, pHat, qHat, nu0: Math.atan2(dot(r, qHat), dot(r, pHat)) };
}

/**
 * The osculating conic through `state` (ellipse, parabola or hyperbola) as offsets from the body's position (km,
 * same frame), stepped in true anomaly: steps start at `minStepRad` next to the body (dense where the camera may
 * be close) and grow by `growth`, capped so a step never spans more than `maxArc` of the local radius (smooth
 * at perihelion even for e ≈ 0.99, where uniform eccentric-anomaly steps look faceted). Open orbits stop at
 * `maxRadiusKm`; a full ellipse closes on itself.
 */
export function conicOffsetsAround(
  state: StateVector,
  muKm3S2: number,
  minStepRad: number,
  maxRadiusKm = OPEN_ORBIT_MAX_KM,
  growth = 1.05,
  maxArc = 0.02,
): Float64Array {
  const { pKm, e, pHat, qHat, nu0 } = conicOf(state, muKm3S2);
  const radius = (nu: number): number => pKm / (1 + e * Math.cos(nu));
  // True-anomaly limits: a whole turn for an ellipse; for an open orbit, where r reaches maxRadiusKm (always
  // before the asymptote at acos(−1/e)), or the current point if the body is already beyond.
  let lo = nu0 - Math.PI;
  let hi = nu0 + Math.PI;
  const closed = e < 1 && radius(Math.PI) <= maxRadiusKm;
  if (!closed) {
    const cosLimit = (pKm / Math.max(maxRadiusKm, radius(nu0)) - 1) / Math.max(e, 1e-12);
    const limit = Math.acos(Math.max(-1, Math.min(1, cosLimit)));
    lo = -limit;
    hi = limit;
  }
  // Largest step at ν: arc length r·√(1 + (e sin ν / (1 + e cos ν))²)·dν kept below maxArc·r.
  const maxStep = (nu: number): number => {
    const k = (e * Math.sin(nu)) / (1 + e * Math.cos(nu));
    return maxArc / Math.sqrt(1 + k * k);
  };
  const walk = (dir: 1 | -1, end: number): number[] => {
    const out: number[] = [];
    let step = minStepRad;
    let nu = nu0;
    for (;;) {
      nu += dir * Math.min(step, maxStep(nu));
      if ((dir > 0 && nu >= end) || (dir < 0 && nu <= end)) break;
      out.push(nu);
      step *= growth;
    }
    out.push(end);
    return out;
  };
  // An ellipse is walked from the body both ways to the opposite point (closing the loop there).
  const anomalies = [...walk(-1, lo).reverse(), nu0, ...walk(1, hi)];
  const r0 = state.posKm;
  const out = new Float64Array(anomalies.length * 3);
  anomalies.forEach((nu, i) => {
    const rn = radius(nu);
    const c = rn * Math.cos(nu);
    const s = rn * Math.sin(nu);
    for (let k = 0; k < 3; k++) out[i * 3 + k] = c * (pHat[k] ?? 0) + s * (qHat[k] ?? 0) - (r0[k] ?? 0);
  });
  return out;
}

export interface PerihelionPassages {
  /** TDB Julian dates of the previous and next perihelion on the osculating orbit (undefined when none). */
  readonly lastTdbJd: number | undefined;
  readonly nextTdbJd: number | undefined;
}

/** Perihelion passages of the osculating orbit around `tTdbJd` (two-body: a few days off for a distant one). */
export function perihelionPassages(state: StateVector, muKm3S2: number, tTdbJd: number): PerihelionPassages {
  const r = state.posKm;
  const v = state.velKmS;
  const rn = length(r);
  const vn = length(v);
  const energy = (vn * vn) / 2 - muKm3S2 / rn;
  const a = -muKm3S2 / (2 * energy);
  const { e, nu0 } = conicOf(state, muKm3S2);
  const day = 86_400;
  if (e < 1 && energy < 0) {
    const n = Math.sqrt(muKm3S2 / (a * a * a));
    const eAnomaly = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu0 / 2));
    let since = (eAnomaly - e * Math.sin(eAnomaly)) / n;
    const periodS = (2 * Math.PI) / n;
    if (since < 0) since += periodS;
    const last = tTdbJd - since / day;
    return { lastTdbJd: last, nextTdbJd: last + periodS / day };
  }
  // Hyperbola (a < 0); a parabola is close enough to a barely open hyperbola here.
  const aAbs = Math.abs(a);
  const n = Math.sqrt(muKm3S2 / (aAbs * aAbs * aAbs));
  const ee = Math.max(e, 1 + 1e-9);
  const f = 2 * Math.atanh(Math.sqrt((ee - 1) / (ee + 1)) * Math.tan(nu0 / 2));
  const since = (ee * Math.sinh(f) - f) / n;
  return since >= 0
    ? { lastTdbJd: tTdbJd - since / day, nextTdbJd: undefined }
    : { lastTdbJd: undefined, nextTdbJd: tTdbJd - since / day };
}

/**
 * Total visual magnitude from the usual comet law m = M1 + 5 log Δ + 2.5 K1 log r (Δ from the Earth, r from the
 * Sun, both in au). An estimate: comets often depart from it by magnitudes.
 */
export function cometMagnitude(m1: number, k1: number, rAu: number, deltaAu: number): number {
  return m1 + 5 * Math.log10(deltaAu) + 2.5 * k1 * Math.log10(rAu);
}

/**
 * Visual magnitude of an asteroid from the IAU H–G phase law (Bowell et al. 1989): H absolute magnitude, G slope,
 * r and Δ in au, α the Sun–asteroid–Earth phase angle.
 */
export function asteroidMagnitude(
  h: number,
  g: number,
  rAu: number,
  deltaAu: number,
  phaseRad: number,
): number {
  const t = Math.tan(phaseRad / 2);
  const phi1 = Math.exp(-3.33 * t ** 0.63);
  const phi2 = Math.exp(-1.87 * t ** 1.22);
  return h + 5 * Math.log10(rAu * deltaAu) - 2.5 * Math.log10((1 - g) * phi1 + g * phi2);
}
