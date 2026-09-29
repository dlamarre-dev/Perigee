/**
 * Natural satellites for the solar-system view (pure, no Three.js). Positions and velocities are relative to
 * the parent planet, in EQJ (km, km/s):
 * - the Moon and the Galilean moons come from astronomy-engine (analytical theories);
 * - the others from JPL SSD mean orbital elements: two-body Kepler motion plus uniform apsidal and nodal
 *   precession, the angles being referred to the tabulated plane (local Laplace plane, planet equator or
 *   ecliptic). Mean elements ignore short-period perturbations: positions are approximate (visual use only).
 */
import type { Moon, MoonElements } from '../data/schemas';
import { Astronomy } from './astronomy';
import { iauOrientationEqj } from './bodies';
import { AU_KM, DEG_TO_RAD, SECONDS_PER_DAY } from './constants';
import type { StateVector } from './hermite';
import { OBLIQUITY_J2000_RAD } from './planets';
import { quatFromAxisAngle, quatMultiply, quatRotate, type Quat } from './quat';

const DAYS_PER_YEAR = 365.25;
const AU_PER_DAY_TO_KM_S = AU_KM / SECONDS_PER_DAY;

/** Solves Kepler's equation M = E − e sin E (radians), Newton iterations. */
export function solveKepler(meanAnomalyRad: number, e: number): number {
  const m = (((meanAnomalyRad % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  let E = e < 0.8 ? m : Math.PI * Math.sign(m || 1);
  for (let k = 0; k < 30; k++) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

/** Orientation EQJ ← reference plane of the elements (x towards the plane's ascending node on the reference). */
export function referencePlaneEqj(el: MoonElements): Quat {
  switch (el.referencePlane) {
    case 'icrf':
      return { x: 0, y: 0, z: 0, w: 1 };
    case 'ecliptic':
      // Ecliptic J2000: x towards the equinox, tilted by the obliquity about it.
      return quatFromAxisAngle([1, 0, 0], OBLIQUITY_J2000_RAD);
    case 'laplace':
    case 'equator': {
      if (el.laplacePoleRaDeg === undefined || el.laplacePoleDecDeg === undefined) {
        throw new Error(`${el.referencePlane} plane needs its pole`);
      }
      // Same construction as the IAU body frames, with W = 0: x is the plane's ascending node on the ICRF equator.
      return iauOrientationEqj(el.laplacePoleRaDeg * DEG_TO_RAD, el.laplacePoleDecDeg * DEG_TO_RAD, 0);
    }
  }
}

/** Planet-relative state from mean elements at `tdbJd`. */
export function meanElementsState(el: MoonElements, tdbJd: number): StateVector {
  const dtDays = tdbJd - el.epochJdTdb;
  // The tabulated period is that of the mean longitude λ = Ω + ω + M. JPL gives unsigned precession periods:
  // the longitude of periapsis ϖ = Ω + ω advances; the node regresses (advances for retrograde orbits, i > 90°).
  // Hence Ṁ = λ̇ − ϖ̇ and ω̇ = ϖ̇ − Ω̇, so that λ keeps the tabulated rate.
  const rate = (periodYears: number | undefined): number =>
    periodYears ? (2 * Math.PI) / (periodYears * DAYS_PER_YEAR) : 0;
  const lambdaDot = el.nDegPerDay * DEG_TO_RAD;
  const varpiDot = rate(el.apsidalPeriodYears);
  const nodeDot = (el.iDeg > 90 ? 1 : -1) * rate(el.nodalPeriodYears);
  const node = el.nodeDeg * DEG_TO_RAD + nodeDot * dtDays;
  const w = el.wDeg * DEG_TO_RAD + (varpiDot - nodeDot) * dtDays;
  const M = el.MDeg * DEG_TO_RAD + (lambdaDot - varpiDot) * dtDays;
  const nRadPerDay = el.nDegPerDay * DEG_TO_RAD;
  const i = el.iDeg * DEG_TO_RAD;
  const E = solveKepler(M, el.e);
  const b = el.aKm * Math.sqrt(1 - el.e * el.e);
  const nRadPerS = nRadPerDay / SECONDS_PER_DAY;
  const denom = 1 - el.e * Math.cos(E);
  // Perifocal frame (x to periapsis).
  const pos: [number, number, number] = [el.aKm * (Math.cos(E) - el.e), b * Math.sin(E), 0];
  const vel: [number, number, number] = [
    (-el.aKm * nRadPerS * Math.sin(E)) / denom,
    (b * nRadPerS * Math.cos(E)) / denom,
    0,
  ];
  // Reference plane ← perifocal: Rz(Ω) · Rx(i) · Rz(ω); then EQJ ← reference plane.
  const q = quatMultiply(
    referencePlaneEqj(el),
    quatMultiply(
      quatFromAxisAngle([0, 0, 1], node),
      quatMultiply(quatFromAxisAngle([1, 0, 0], i), quatFromAxisAngle([0, 0, 1], w)),
    ),
  );
  return { posKm: quatRotate(q, pos), velKmS: quatRotate(q, vel) };
}

const GALILEAN = ['io', 'europa', 'ganymede', 'callisto'] as const;

function fromAstronomy(s: Astronomy.StateVector): StateVector {
  return {
    posKm: [s.x * AU_KM, s.y * AU_KM, s.z * AU_KM],
    velKmS: [s.vx * AU_PER_DAY_TO_KM_S, s.vy * AU_PER_DAY_TO_KM_S, s.vz * AU_PER_DAY_TO_KM_S],
  };
}

/**
 * Planet-relative EQJ state of a moon, or undefined when its model cannot produce one. `jupiter` caches the
 * Galilean moons for one date (they are computed together).
 */
export function moonState(
  moon: Moon,
  date: Date,
  tdbJd: number,
  cache: { jupiterDateMs?: number; jupiter?: Astronomy.JupiterMoonsInfo } = {},
): StateVector | undefined {
  if (moon.model === 'mean-elements')
    return moon.elements ? meanElementsState(moon.elements, tdbJd) : undefined;
  if (moon.id === 'moon') return fromAstronomy(Astronomy.GeoMoonState(date));
  const galilean = GALILEAN.find((g) => g === moon.id);
  if (galilean) {
    if (cache.jupiterDateMs !== date.getTime() || !cache.jupiter) {
      cache.jupiter = Astronomy.JupiterMoons(date);
      cache.jupiterDateMs = date.getTime();
    }
    return fromAstronomy(cache.jupiter[galilean]);
  }
  return undefined;
}
