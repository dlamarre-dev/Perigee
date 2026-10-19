/**
 * Ground points and orbits for the engine's answers (machine interface): the surface point below an object with the
 * country or sea under it, whether it is in sunlight, and its orbit (mean SGP4 elements for Earth satellites,
 * instantaneous two-body elements otherwise). Degrees and minutes only in the outputs.
 */
import * as Astronomy from 'astronomy-engine';
import { bodyOrientationEqj, MARS_RADIUS_KM, MOON_RADIUS_KM } from '../astro/bodies';
import { RAD_TO_DEG } from '../astro/constants';
import { sunlitFraction } from '../astro/eclipse';
import { GM_KM3_S2, osculatingElements } from '../astro/kepler';
import { apsides, orbitRegime, periodMin, semiMajorAxisKm, type OrbitRegime } from '../astro/orbit';
import { OBLIQUITY_J2000_RAD } from '../astro/planets';
import { quatConjugate, quatRotate } from '../astro/quat';
import { gmstRad } from '../astro/time';
import { length, normalize, scale, type Vec3 } from '../astro/vec3';
import type { Omm } from '../data/schemas';
import { degrees, geodeticFromEcef, planetocentric, regionAt, round, type Region } from './ground';
import type { ObjectRef } from './objects';
import { temeToEcef } from './passes';

export interface GroundPoint {
  readonly body: 'earth' | 'moon' | 'mars';
  readonly latDeg: number;
  /** East longitude, −180 to 180. */
  readonly lonDeg: number;
  /** Height above the WGS 84 ellipsoid (Earth) or the mean radius (Moon, Mars), km. */
  readonly heightKm: number;
  /** Earth: the country, else the named sea or ocean, below (Natural Earth 1:110m). */
  readonly over?: Region;
  readonly note: string;
}

/** EQJ → true equator of date (≈ TEME), for Earth-fixed points of objects given in EQJ. */
function eqjToEqd(v: Vec3, date: Date): Vec3 {
  const r = Astronomy.RotateVector(
    Astronomy.Rotation_EQJ_EQD(Astronomy.MakeTime(date)),
    new Astronomy.Vector(v[0], v[1], v[2], Astronomy.MakeTime(date)),
  );
  return [r.x, r.y, r.z];
}

/**
 * Surface point below an object relative to the Earth, the Moon or Mars (undefined for other centres). `teme`:
 * the SGP4 state of an Earth satellite, used directly (no frame round trip).
 */
export function groundPoint(
  centreId: string,
  relEqjKm: Vec3,
  date: Date,
  temeKm?: Vec3,
): GroundPoint | undefined {
  if (centreId === 'earth') {
    const ecef = temeToEcef(temeKm ?? eqjToEqd(relEqjKm, date), gmstRad(date));
    const g = geodeticFromEcef(ecef);
    const over = regionAt(g.latRad, g.lonRad);
    return {
      body: 'earth',
      latDeg: degrees(g.latRad),
      lonDeg: degrees(g.lonRad),
      heightKm: round(g.heightKm, 2),
      ...(over ? { over } : {}),
      note: 'Geodetic coordinates on WGS 84 (Earth-fixed frame by GMST, polar motion neglected: well under 1 km); country or sea from Natural Earth 1:110m maps (borders to ~10 km).',
    };
  }
  if (centreId === 'moon:moon' || centreId === 'mars') {
    const moon = centreId === 'moon:moon';
    const body = moon ? Astronomy.Body.Moon : Astronomy.Body.Mars;
    const fixed = quatRotate(quatConjugate(bodyOrientationEqj(body, date)), relEqjKm);
    const p = planetocentric(fixed);
    return {
      body: moon ? 'moon' : 'mars',
      latDeg: degrees(p.latRad),
      lonDeg: degrees(p.lonRad),
      heightKm: round(length(relEqjKm) - (moon ? MOON_RADIUS_KM : MARS_RADIUS_KM), 2),
      note: 'Planetocentric coordinates (east longitude) in the IAU rotation model of the body, above its mean radius.',
    };
  }
  return undefined;
}

/**
 * Share of the Sun's disc seen from the object (1 in sunlight, 0 in the centre body's umbra), given its
 * heliocentric position and the centre's.
 */
export function sunlight(objectHelioKm: Vec3, centreHelioKm: Vec3, centreRadiusKm: number): number {
  const toCentre: Vec3 = [
    centreHelioKm[0] - objectHelioKm[0],
    centreHelioKm[1] - objectHelioKm[1],
    centreHelioKm[2] - objectHelioKm[2],
  ];
  return sunlitFraction(toCentre, centreRadiusKm, normalize(scale(objectHelioKm, -1)), length(objectHelioKm));
}

export interface OrbitDescription {
  readonly centre: string;
  readonly kind: 'mean-elements' | 'osculating';
  readonly semiMajorAxisKm?: number;
  readonly eccentricity: number;
  readonly inclinationDeg: number;
  /** Reference plane of the inclination. */
  readonly plane: string;
  readonly periodMin?: number;
  readonly periapsisAltitudeKm?: number;
  readonly apoapsisAltitudeKm?: number;
  readonly regime?: OrbitRegime;
  readonly raanDeg?: number;
  readonly argumentOfPeriapsisDeg?: number;
  readonly epoch?: string;
  readonly note: string;
}

/** Earth satellites: SGP4 mean elements (Kozai mean motion; altitudes above the equatorial radius). */
export function meanOrbit(omm: Omm): OrbitDescription {
  const a = apsides(omm.MEAN_MOTION, omm.ECCENTRICITY);
  return {
    centre: 'earth',
    kind: 'mean-elements',
    semiMajorAxisKm: round(semiMajorAxisKm(omm.MEAN_MOTION), 1),
    eccentricity: round(omm.ECCENTRICITY, 6),
    inclinationDeg: round(omm.INCLINATION, 3),
    plane: 'Earth equator (TEME)',
    periodMin: round(periodMin(omm.MEAN_MOTION), 2),
    periapsisAltitudeKm: round(a.perigeeAltKm, 1),
    apoapsisAltitudeKm: round(a.apogeeAltKm, 1),
    regime: orbitRegime(omm.MEAN_MOTION, omm.ECCENTRICITY),
    raanDeg: round(omm.RA_OF_ASC_NODE, 3),
    argumentOfPeriapsisDeg: round(omm.ARG_OF_PERICENTER, 3),
    epoch: new Date(Date.parse(`${omm.EPOCH}Z`)).toISOString(),
    note: 'Mean orbital elements of the published element set (perigee and apogee as heights above the equatorial radius, 6378.137 km). Regimes: LEO apogee below 2000 km, GEO about one revolution a day, HEO eccentricity of 0.25 or more, MEO otherwise.',
  };
}

/** Gravitational parameter of a centre for two-body elements (km³/s²), when known. */
export function gmOf(centre: ObjectRef): number | undefined {
  if (centre.kind === 'sun') return GM_KM3_S2.sun;
  if (centre.kind === 'planet') return centre.id === 'earth' ? GM_KM3_S2.earth : centre.planet.gmKm3S2;
  if (centre.kind === 'moon' && centre.moon.id === 'moon') return GM_KM3_S2.moon;
  return undefined;
}

/** Rotation taking EQJ vectors to the centre's equator (the ecliptic for the Sun) and that plane's name. */
function equatorFrame(centre: ObjectRef, date: Date): { rotate: (v: Vec3) => Vec3; plane: string } {
  if (centre.kind === 'sun') {
    const c = Math.cos(OBLIQUITY_J2000_RAD);
    const s = Math.sin(OBLIQUITY_J2000_RAD);
    return { rotate: ([x, y, z]) => [x, c * y + s * z, -s * y + c * z], plane: 'ecliptic (J2000)' };
  }
  if (centre.kind === 'planet' && centre.id === 'earth')
    return { rotate: (v) => eqjToEqd(v, date), plane: 'Earth equator of date' };
  const body =
    centre.kind === 'planet'
      ? centre.planet.body
      : centre.kind === 'moon' && centre.moon.id === 'moon'
        ? Astronomy.Body.Moon
        : undefined;
  if (body !== undefined) {
    try {
      const q = quatConjugate(bodyOrientationEqj(body, date));
      return {
        rotate: (v) => quatRotate(q, v),
        plane: `equator of ${centre.kind === 'planet' ? centre.planet.name.en : 'the Moon'} (IAU)`,
      };
    } catch {
      // No IAU rotation model for this body: J2000 equator.
    }
  }
  return { rotate: (v) => v, plane: 'Earth equator J2000 (ICRF)' };
}

/** Instantaneous two-body (osculating) elements from a state relative to the centre. */
export function osculatingOrbit(
  centre: ObjectRef,
  posKm: Vec3,
  velKmS: Vec3,
  date: Date,
  radiusKm: number | undefined,
): OrbitDescription | undefined {
  const mu = gmOf(centre);
  if (mu === undefined) return undefined;
  const { rotate, plane } = equatorFrame(centre, date);
  const el = osculatingElements({ posKm: rotate(posKm), velKmS: rotate(velKmS) }, mu);
  const r = radiusKm ?? 0;
  return {
    centre: centre.id,
    kind: 'osculating',
    ...(el.periodS !== undefined ? { semiMajorAxisKm: round(el.semiMajorAxisKm, 1) } : {}),
    eccentricity: round(el.eccentricity, 6),
    inclinationDeg: round(el.inclinationRad * RAD_TO_DEG, 3),
    plane,
    ...(el.periodS !== undefined ? { periodMin: round(el.periodS / 60, 2) } : {}),
    periapsisAltitudeKm: round(el.periapsisRadiusKm - r, 1),
    ...(el.apoapsisRadiusKm !== undefined ? { apoapsisAltitudeKm: round(el.apoapsisRadiusKm - r, 1) } : {}),
    note: `Two-body elements of the instantaneous state around ${centre.id} (osculating): an orbit perturbed by other bodies or by the centre's shape drifts away from them over time${el.periodS === undefined ? '; the trajectory is unbound (hyperbolic)' : ''}. Altitudes above the centre's mean radius${r ? '' : ' (unknown radius: distances from its centre)'}.`,
  };
}
