/**
 * Well-known stars (catalog/stars.json) as directions at infinity: ICRS J2000 right ascension and declination →
 * unit vector in EQJ (the frame of the sky map, src/render/SkyMesh.ts). Proper motion since J2000 (at most a
 * few arcminutes: 4.5′ for Barnard's Star, the fastest, by 2026) and parallax are below what the view can show.
 */
import { DEG_TO_RAD } from './constants';
import type { Vec3 } from './vec3';

/** The catalogue's two groups, each named on the sky by its own box: bright stars, and the Sun's neighbours. */
export const BRIGHT_STAR_MAX_MAGNITUDE = 2.5;
export const NEARBY_STAR_MAX_LY = 20;

export function isBrightStar(star: { readonly magnitude: number }): boolean {
  return star.magnitude <= BRIGHT_STAR_MAX_MAGNITUDE;
}

export function isNearbyStar(star: { readonly distanceLy: number }): boolean {
  return star.distanceLy < NEARBY_STAR_MAX_LY;
}

export function raDecToUnit(raRad: number, decRad: number): Vec3 {
  const c = Math.cos(decRad);
  return [c * Math.cos(raRad), c * Math.sin(raRad), Math.sin(decRad)];
}

export function starDirectionEqj(star: { readonly raDeg: number; readonly decDeg: number }): Vec3 {
  return raDecToUnit(star.raDeg * DEG_TO_RAD, star.decDeg * DEG_TO_RAD);
}

/** Right ascension as hours, minutes and seconds ("6h 45m 09s"). */
export function formatRa(raDeg: number): string {
  const totalS = Math.round((((raDeg % 360) + 360) % 360) * 240) % 86_400;
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

/** Declination as signed degrees, arcminutes and arcseconds ("−16° 42′ 58″"). */
export function formatDec(decDeg: number): string {
  const totalS = Math.round(Math.abs(decDeg) * 3600);
  const d = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  return `${decDeg < 0 ? '−' : '+'}${d}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
}
