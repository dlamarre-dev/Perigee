/**
 * Planets for the solar-system view (pure). Positions from astronomy-engine, heliocentric EQJ in km.
 * Physical data: NASA planetary fact sheets (mean radius, sidereal orbital period).
 */
import { Astronomy } from './astronomy';
import { AU_KM, DEG_TO_RAD, SECONDS_PER_DAY } from './constants';
import { length, scale, type Vec3 } from './vec3';

export interface PlanetInfo {
  readonly id: string;
  readonly body: Astronomy.Body;
  readonly name: { readonly en: string; readonly fr: string };
  readonly radiusKm: number;
  /** Oblate giants: equatorial, equatorial, polar radius at the 1-bar level (km, NASA fact sheets). */
  readonly radiiKm?: readonly [number, number, number];
  readonly periodDays: number;
  /** GM of the planet system (km³/s², JPL DE440; the Earth value includes the Moon). */
  readonly gmKm3S2: number;
  readonly color: string;
  readonly dwarf?: boolean;
  /** Ring texture extent (km from the centre), texture in public/textures/<id>/rings.png. */
  readonly rings?: RingExtent;
}

export interface RingExtent {
  readonly innerKm: number;
  readonly outerKm: number;
}

/**
 * Saturn: D-ring edge to past the F ring; Uranus: ring 6 to past ε; Neptune: Galle to past Adams (NASA ring fact
 * sheets).
 */
export const SATURN_RINGS: RingExtent = { innerKm: 74_000, outerKm: 140_500 };
export const URANUS_RINGS: RingExtent = { innerKm: 41_500, outerKm: 51_500 };
export const NEPTUNE_RINGS: RingExtent = { innerKm: 40_500, outerKm: 63_500 };
/** Ring alpha channel encodes sqrt(τ / RING_TAU_SCALE), τ = normal optical depth. */
export const RING_TAU_SCALE = 4;

export const SUN_RADIUS_KM = 695_700;
export const SUN_GM_KM3_S2 = 132_712_440_041.279_42;
/** Mean obliquity of the ecliptic at J2000 (IAU 2006). */
export const OBLIQUITY_J2000_RAD = 23.439_279_444 * DEG_TO_RAD;

export const PLANETS: readonly PlanetInfo[] = [
  {
    id: 'mercury',
    body: Astronomy.Body.Mercury,
    name: { en: 'Mercury', fr: 'Mercure' },
    radiusKm: 2439.7,
    periodDays: 87.969,
    gmKm3S2: 22_031.868_551,
    color: '#b5a99a',
  },
  {
    id: 'venus',
    body: Astronomy.Body.Venus,
    name: { en: 'Venus', fr: 'Vénus' },
    radiusKm: 6051.8,
    periodDays: 224.701,
    gmKm3S2: 324_858.592,
    color: '#e8cf9a',
  },
  {
    id: 'earth',
    body: Astronomy.Body.Earth,
    name: { en: 'Earth', fr: 'Terre' },
    radiusKm: 6371.0,
    periodDays: 365.256,
    gmKm3S2: 403_503.235_502,
    color: '#6fa8ff',
  },
  {
    id: 'mars',
    body: Astronomy.Body.Mars,
    name: { en: 'Mars', fr: 'Mars' },
    radiusKm: 3389.5,
    periodDays: 686.98,
    gmKm3S2: 42_828.375_214,
    color: '#d9774b',
  },
  {
    id: 'jupiter',
    body: Astronomy.Body.Jupiter,
    name: { en: 'Jupiter', fr: 'Jupiter' },
    radiusKm: 69_911,
    radiiKm: [71_492, 71_492, 66_854],
    periodDays: 4332.59,
    gmKm3S2: 126_712_764.1,
    color: '#d8b98f',
  },
  {
    id: 'saturn',
    body: Astronomy.Body.Saturn,
    name: { en: 'Saturn', fr: 'Saturne' },
    radiusKm: 58_232,
    radiiKm: [60_268, 60_268, 54_364],
    periodDays: 10_759.22,
    gmKm3S2: 37_940_584.841_8,
    color: '#e3d19c',
    rings: SATURN_RINGS,
  },
  {
    id: 'uranus',
    body: Astronomy.Body.Uranus,
    name: { en: 'Uranus', fr: 'Uranus' },
    radiusKm: 25_362,
    radiiKm: [25_559, 25_559, 24_973],
    periodDays: 30_688.5,
    gmKm3S2: 5_794_556.4,
    color: '#9fd8e0',
    rings: URANUS_RINGS,
  },
  {
    id: 'neptune',
    body: Astronomy.Body.Neptune,
    name: { en: 'Neptune', fr: 'Neptune' },
    radiusKm: 24_622,
    radiiKm: [24_764, 24_764, 24_341],
    periodDays: 60_182,
    gmKm3S2: 6_836_527.100_58,
    color: '#6f8fe8',
    rings: NEPTUNE_RINGS,
  },
  {
    id: 'pluto',
    body: Astronomy.Body.Pluto,
    name: { en: 'Pluto', fr: 'Pluton' },
    radiusKm: 1188.3,
    periodDays: 90_560,
    gmKm3S2: 975.5,
    color: '#c7b39c',
    dwarf: true,
  },
];

/** Heliocentric state (km, km/s, EQJ, geometric). */
export function heliocentricState(body: Astronomy.Body, date: Date): { posKm: Vec3; velKmS: Vec3 } {
  const st = Astronomy.HelioState(body, date);
  const kmS = AU_KM / SECONDS_PER_DAY;
  return {
    posKm: [st.x * AU_KM, st.y * AU_KM, st.z * AU_KM],
    velKmS: [st.vx * kmS, st.vy * kmS, st.vz * kmS],
  };
}

/**
 * Hill-sphere radius (km) of a planet at heliocentric distance `distanceKm`: well inside it, a spacecraft is
 * bound to the planet rather than following a heliocentric path of its own.
 */
export function hillRadiusKm(planet: PlanetInfo, distanceKm: number): number {
  return distanceKm * Math.cbrt(planet.gmKm3S2 / (3 * SUN_GM_KM3_S2));
}

/** Heliocentric position (km, EQJ, geometric). */
export function heliocentricKm(body: Astronomy.Body, date: Date): Vec3 {
  const v = Astronomy.HelioVector(body, date);
  return [v.x * AU_KM, v.y * AU_KM, v.z * AU_KM];
}

/**
 * Optional logarithmic distance scale (visual only): radius r ↦ A·ln(1 + r / r₀), with A chosen so 1 AU maps to
 * 1 AU. Directions are preserved; the inner planets keep their spacing while Voyager 1 (~170 AU) comes within
 * ~4 AU. Positions shown in this mode are explicitly not to scale.
 */
export const LOG_SCALE_R0_KM = 0.3 * AU_KM;
const LOG_SCALE_A = AU_KM / Math.log(1 + AU_KM / LOG_SCALE_R0_KM);

export function logScaleRadiusKm(rKm: number): number {
  return LOG_SCALE_A * Math.log(1 + rKm / LOG_SCALE_R0_KM);
}

export function logScalePosition(p: Vec3): Vec3 {
  const r = length(p);
  return r === 0 ? p : scale(p, logScaleRadiusKm(r) / r);
}
