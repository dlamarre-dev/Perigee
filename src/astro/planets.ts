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
  readonly periodDays: number;
  readonly color: string;
  readonly dwarf?: boolean;
}

export const SUN_RADIUS_KM = 695_700;
/** Mean obliquity of the ecliptic at J2000 (IAU 2006). */
export const OBLIQUITY_J2000_RAD = 23.439_279_444 * DEG_TO_RAD;

export const PLANETS: readonly PlanetInfo[] = [
  {
    id: 'mercury',
    body: Astronomy.Body.Mercury,
    name: { en: 'Mercury', fr: 'Mercure' },
    radiusKm: 2439.7,
    periodDays: 87.969,
    color: '#b5a99a',
  },
  {
    id: 'venus',
    body: Astronomy.Body.Venus,
    name: { en: 'Venus', fr: 'Vénus' },
    radiusKm: 6051.8,
    periodDays: 224.701,
    color: '#e8cf9a',
  },
  {
    id: 'earth',
    body: Astronomy.Body.Earth,
    name: { en: 'Earth', fr: 'Terre' },
    radiusKm: 6371.0,
    periodDays: 365.256,
    color: '#6fa8ff',
  },
  {
    id: 'mars',
    body: Astronomy.Body.Mars,
    name: { en: 'Mars', fr: 'Mars' },
    radiusKm: 3389.5,
    periodDays: 686.98,
    color: '#d9774b',
  },
  {
    id: 'jupiter',
    body: Astronomy.Body.Jupiter,
    name: { en: 'Jupiter', fr: 'Jupiter' },
    radiusKm: 69_911,
    periodDays: 4332.59,
    color: '#d8b98f',
  },
  {
    id: 'saturn',
    body: Astronomy.Body.Saturn,
    name: { en: 'Saturn', fr: 'Saturne' },
    radiusKm: 58_232,
    periodDays: 10_759.22,
    color: '#e3d19c',
  },
  {
    id: 'uranus',
    body: Astronomy.Body.Uranus,
    name: { en: 'Uranus', fr: 'Uranus' },
    radiusKm: 25_362,
    periodDays: 30_688.5,
    color: '#9fd8e0',
  },
  {
    id: 'neptune',
    body: Astronomy.Body.Neptune,
    name: { en: 'Neptune', fr: 'Neptune' },
    radiusKm: 24_622,
    periodDays: 60_182,
    color: '#6f8fe8',
  },
  {
    id: 'pluto',
    body: Astronomy.Body.Pluto,
    name: { en: 'Pluto', fr: 'Pluton' },
    radiusKm: 1188.3,
    periodDays: 90_560,
    color: '#c7b39c',
    dwarf: true,
  },
];

/** Heliocentric position (km, EQJ, geometric). */
export function heliocentricKm(body: Astronomy.Body, date: Date): Vec3 {
  const v = Astronomy.HelioVector(body, date);
  return [v.x * AU_KM, v.y * AU_KM, v.z * AU_KM];
}

/** One orbit centred on `date` (packed xyz, km, EQJ). */
export function orbitPolyline(planet: PlanetInfo, date: Date, points = 360): Float64Array {
  const out = new Float64Array((points + 1) * 3);
  const periodMs = planet.periodDays * SECONDS_PER_DAY * 1000;
  for (let i = 0; i <= points; i++) {
    const t = new Date(date.getTime() + (i / points - 0.5) * periodMs);
    out.set(heliocentricKm(planet.body, t), i * 3);
  }
  return out;
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
