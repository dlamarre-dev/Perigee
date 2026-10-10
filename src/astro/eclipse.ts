/**
 * Share of the Sun's disc seen from a point near a spherical body (1 in full sunlight, 0 in the umbra), for the
 * lighting of spacecraft models: both discs are treated as flat circles on the sky (small angles), the body as a
 * sphere, and the Sun's limb darkening is ignored.
 */
import { SUN_RADIUS_KM } from './planets';
import { dot, length, type Vec3 } from './vec3';

/**
 * @param toBodyKm vector from the point to the body's centre (km)
 * @param bodyRadiusKm radius of the body (km)
 * @param sunDir unit vector from the point towards the Sun
 * @param sunDistanceKm distance from the point to the Sun (km)
 */
export function sunlitFraction(
  toBodyKm: Vec3,
  bodyRadiusKm: number,
  sunDir: Vec3,
  sunDistanceKm: number,
): number {
  const distKm = length(toBodyKm);
  if (distKm <= bodyRadiusKm) return 0;
  const sunR = Math.asin(Math.min(1, SUN_RADIUS_KM / sunDistanceKm));
  const bodyR = Math.asin(bodyRadiusKm / distKm);
  const sep = Math.acos(Math.min(1, Math.max(-1, dot(toBodyKm, sunDir) / distKm)));
  if (sep >= sunR + bodyR) return 1;
  if (sep <= bodyR - sunR) return 0;
  if (sep <= sunR - bodyR) return 1 - (bodyR * bodyR) / (sunR * sunR);
  return 1 - circleOverlap(sunR, bodyR, sep) / (Math.PI * sunR * sunR);
}

/** Area shared by two circles of radii `a` and `b` whose centres are `d` apart (partial overlap). */
function circleOverlap(a: number, b: number, d: number): number {
  const alpha = Math.acos(Math.min(1, Math.max(-1, (d * d + a * a - b * b) / (2 * d * a))));
  const beta = Math.acos(Math.min(1, Math.max(-1, (d * d + b * b - a * a) / (2 * d * b))));
  const kite = 0.5 * Math.sqrt(Math.max(0, (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b)));
  return a * a * alpha + b * b * beta - kite;
}
