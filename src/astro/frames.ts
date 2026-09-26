import type { Vec3 } from './vec3';

/** Rotation of a vector by +angleRad about the Z axis (right-handed, counter-clockwise seen from +Z). */
export function rotZ(v: Vec3, angleRad: number): Vec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

/**
 * Inertial (equatorial) → Earth-fixed. Rotates by −GMST about the pole.
 * Approximation: polar motion and nutation are neglected, and the J2000 equator is treated as the
 * equator of date (precession ≈ 0.36° in 2026). Good enough for visualisation, not for geodesy.
 */
export function eciToEcef(vEci: Vec3, gmstRad: number): Vec3 {
  return rotZ(vEci, -gmstRad);
}

export function ecefToEci(vEcef: Vec3, gmstRad: number): Vec3 {
  return rotZ(vEcef, gmstRad);
}

/** Unit vector for planetocentric latitude/longitude (rad), Z = north pole, X = prime meridian. */
export function latLonToUnit(latRad: number, lonRad: number): Vec3 {
  const cl = Math.cos(latRad);
  return [cl * Math.cos(lonRad), cl * Math.sin(lonRad), Math.sin(latRad)];
}
