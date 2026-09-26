/**
 * Mean-element orbit descriptors (pure). Used for the info panel and the orbit-regime facet; positions
 * always come from SGP4, never from these two-body approximations.
 */
import { EARTH_EQUATORIAL_RADIUS_KM, SECONDS_PER_DAY, TWO_PI } from './constants';

/** Earth gravitational parameter (WGS-72, as used by SGP4). */
export const EARTH_MU_KM3_S2 = 398_600.8;

export type OrbitRegime = 'LEO' | 'MEO' | 'GEO' | 'HEO';
export const ORBIT_REGIMES: readonly OrbitRegime[] = ['LEO', 'MEO', 'GEO', 'HEO'];

export function semiMajorAxisKm(meanMotionRevPerDay: number): number {
  const nRadPerS = (meanMotionRevPerDay * TWO_PI) / SECONDS_PER_DAY;
  return Math.cbrt(EARTH_MU_KM3_S2 / (nRadPerS * nRadPerS));
}

export function periodMin(meanMotionRevPerDay: number): number {
  return 1440 / meanMotionRevPerDay;
}

export interface Apsides {
  readonly perigeeAltKm: number;
  readonly apogeeAltKm: number;
}

/** Perigee/apogee altitudes above the equatorial radius. */
export function apsides(meanMotionRevPerDay: number, eccentricity: number): Apsides {
  const a = semiMajorAxisKm(meanMotionRevPerDay);
  return {
    perigeeAltKm: a * (1 - eccentricity) - EARTH_EQUATORIAL_RADIUS_KM,
    apogeeAltKm: a * (1 + eccentricity) - EARTH_EQUATORIAL_RADIUS_KM,
  };
}

/**
 * Regime classification:
 * - HEO: eccentricity ≥ 0.25 (Molniya, Tundra, GTO…)
 * - GEO: geosynchronous, 0.9–1.1 rev/day with e < 0.1 (inclined GSO included)
 * - LEO: apogee below 2000 km
 * - MEO: everything else
 */
export function orbitRegime(meanMotionRevPerDay: number, eccentricity: number): OrbitRegime {
  if (eccentricity >= 0.25) return 'HEO';
  if (meanMotionRevPerDay >= 0.9 && meanMotionRevPerDay <= 1.1 && eccentricity < 0.1) return 'GEO';
  if (apsides(meanMotionRevPerDay, eccentricity).apogeeAltKm < 2000) return 'LEO';
  return 'MEO';
}
