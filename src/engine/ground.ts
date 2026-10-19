/**
 * Ground points (machine interface): the point of a body's surface directly below an object, and, on the Earth, the
 * country or sea there (Natural Earth 1:110m, public domain: src/engine/regions.json, tools/geo/fetch-regions.ts).
 * Pure functions; angles in radians inside, degrees only in the answers.
 */
import { DEG_TO_RAD, RAD_TO_DEG } from '../astro/constants';
import regionsJson from './regions.json';
import type { Vec3 } from '../astro/vec3';

/** WGS 84 ellipsoid. */
const WGS84_A_KM = 6378.137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export interface Geodetic {
  readonly latRad: number;
  readonly lonRad: number;
  readonly heightKm: number;
}

/** Geodetic latitude, longitude and height above the WGS 84 ellipsoid of an Earth-fixed position (Bowring). */
export function geodeticFromEcef([x, y, z]: Vec3): Geodetic {
  const lonRad = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  const b = WGS84_A_KM * (1 - WGS84_F);
  const ep2 = (WGS84_A_KM * WGS84_A_KM - b * b) / (b * b);
  const theta = Math.atan2(z * WGS84_A_KM, p * b);
  const latRad = Math.atan2(
    z + ep2 * b * Math.sin(theta) ** 3,
    p - WGS84_E2 * WGS84_A_KM * Math.cos(theta) ** 3,
  );
  const sinLat = Math.sin(latRad);
  const n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const heightKm = Math.abs(Math.cos(latRad)) > 1e-9 ? p / Math.cos(latRad) - n : Math.abs(z) - b;
  return { latRad, lonRad, heightKm };
}

/** Earth-fixed position (km) of a point given by geodetic coordinates on WGS 84. */
export function ecefFromGeodetic(latRad: number, lonRad: number, heightKm: number): Vec3 {
  const sinLat = Math.sin(latRad);
  const n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const r = (n + heightKm) * Math.cos(latRad);
  return [r * Math.cos(lonRad), r * Math.sin(lonRad), (n * (1 - WGS84_E2) + heightKm) * sinLat];
}

/** Planetocentric latitude and longitude of a body-fixed position (spherical bodies: the Moon, Mars). */
export function planetocentric([x, y, z]: Vec3): { latRad: number; lonRad: number } {
  return { latRad: Math.atan2(z, Math.hypot(x, y)), lonRad: Math.atan2(y, x) };
}

export interface Region {
  readonly kind: 'country' | 'sea';
  readonly name: { readonly en: string; readonly fr: string };
  /** ISO 3166-1 alpha-2 code of a country, when it has one. */
  readonly iso?: string;
}

interface RegionShape {
  readonly region: Region;
  /** Polygons of [lon, lat, …] rings in hundredths of a degree, with their bounding boxes. */
  readonly polygons: readonly {
    readonly rings: readonly (readonly number[])[];
    readonly box: readonly number[];
  }[];
}

let shapes: { countries: RegionShape[]; seas: RegionShape[] } | undefined;

function loadShapes(): { countries: RegionShape[]; seas: RegionShape[] } {
  const box = (ring: readonly number[]): number[] => {
    let [minLon, minLat, maxLon, maxLat] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < ring.length; i += 2) {
      const lon = ring[i] ?? 0;
      const lat = ring[i + 1] ?? 0;
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    return [minLon, minLat, maxLon, maxLat];
  };
  const shape = (
    kind: Region['kind'],
    r: { en: string; fr: string; iso?: string; polygons: number[][][] },
  ): RegionShape => ({
    region: { kind, name: { en: r.en, fr: r.fr }, ...(r.iso && r.iso !== '-99' ? { iso: r.iso } : {}) },
    polygons: r.polygons.map((rings) => ({ rings, box: box(rings[0] ?? []) })),
  });
  return {
    countries: regionsJson.countries.map((c) => shape('country', c)),
    seas: regionsJson.seas.map((s) => shape('sea', s)),
  };
}

/** Even-odd test of a point against every ring of a polygon (holes included). */
function inside(rings: readonly (readonly number[])[], lon: number, lat: number): boolean {
  let odd = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const xi = ring[i] ?? 0;
      const yi = ring[i + 1] ?? 0;
      const xj = ring[j] ?? 0;
      const yj = ring[j + 1] ?? 0;
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) odd = !odd;
    }
  }
  return odd;
}

function find(list: readonly RegionShape[], lon: number, lat: number): Region | undefined {
  for (const s of list) {
    for (const p of s.polygons) {
      const [minLon = 0, minLat = 0, maxLon = 0, maxLat = 0] = p.box;
      if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
      if (inside(p.rings, lon, lat)) return s.region;
    }
  }
  return undefined;
}

/** The country, else the named sea or ocean, at a point of the Earth (undefined: open water without a name). */
export function regionAt(latRad: number, lonRad: number): Region | undefined {
  shapes ??= loadShapes();
  const lon = Math.round(((((lonRad * RAD_TO_DEG + 180) % 360) + 360) % 360) * 100 - 18_000);
  const lat = Math.round(latRad * RAD_TO_DEG * 100);
  return find(shapes.countries, lon, lat) ?? find(shapes.seas, lon, lat);
}

/** Compass point of an azimuth (radians from north, clockwise): "N", "NNE"… */
export function compassPoint(azimuthRad: number): string {
  const points = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  const i = Math.round((((azimuthRad * RAD_TO_DEG) % 360) + 360) / 22.5) % 16;
  return points[i] ?? 'N';
}

/** Rounds to `digits` decimals (answers stay readable). */
export const round = (value: number, digits: number): number => Number(value.toFixed(digits));

export const degrees = (rad: number, digits = 3): number => round(rad * RAD_TO_DEG, digits);
export const radians = (deg: number): number => deg * DEG_TO_RAD;
