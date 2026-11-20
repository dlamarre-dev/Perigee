/**
 * How much of the Sun's disc the camera sees (glare and lens flare, src/render/SunGlare.ts): bodies in front are
 * spheres whose apparent discs cover part of the Sun's (exact circle overlap, so an eclipse or a planet crossing
 * dims the flare smoothly), and a 3D model is tested along a few rays to points of the disc. Markers, satellites
 * and lines never count, unlike a test on the rendered pixels. All in one frame, km.
 */
import type { Vec3 } from '../astro/vec3';

export interface SunOccluderSphere {
  readonly centreKm: Vec3;
  readonly radiusKm: number;
}

const AU_KM = 149_597_870.7;

/** Area of the intersection of two discs of radii a and b whose centres are d apart. */
export function discOverlap(a: number, b: number, d: number): number {
  if (d >= a + b) return 0;
  if (d <= Math.abs(a - b)) return Math.PI * Math.min(a, b) ** 2;
  const ca = Math.min(1, Math.max(-1, (d * d + a * a - b * b) / (2 * d * a)));
  const cb = Math.min(1, Math.max(-1, (d * d + b * b - a * a) / (2 * d * b)));
  const k = Math.sqrt(Math.max(0, (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b)));
  return a * a * Math.acos(ca) + b * b * Math.acos(cb) - 0.5 * k;
}

/** Angle between two vectors (rad), precise for tiny angles. */
function angleBetween(u: Vec3, v: Vec3): number {
  const cx = u[1] * v[2] - u[2] * v[1];
  const cy = u[2] * v[0] - u[0] * v[2];
  const cz = u[0] * v[1] - u[1] * v[0];
  return Math.atan2(Math.hypot(cx, cy, cz), u[0] * v[0] + u[1] * v[1] + u[2] * v[2]);
}

/** Fraction (0–1) of the Sun's disc seen from `cameraKm` that no sphere covers. */
export function sunDiscVisible(
  cameraKm: Vec3,
  sunKm: Vec3,
  sunRadiusKm: number,
  spheres: readonly SunOccluderSphere[],
): number {
  const toSun: Vec3 = [sunKm[0] - cameraKm[0], sunKm[1] - cameraKm[1], sunKm[2] - cameraKm[2]];
  const sunDistanceKm = Math.hypot(...toSun);
  if (sunDistanceKm <= sunRadiusKm) return 1;
  const sunAngle = Math.asin(sunRadiusKm / sunDistanceKm);
  let covered = 0;
  for (const s of spheres) {
    const to: Vec3 = [s.centreKm[0] - cameraKm[0], s.centreKm[1] - cameraKm[1], s.centreKm[2] - cameraKm[2]];
    const d = Math.hypot(...to);
    if (d <= s.radiusKm) return 0;
    // Only what stands before the Sun.
    if (d - s.radiusKm >= sunDistanceKm) continue;
    const bodyAngle = Math.asin(s.radiusKm / d);
    covered += discOverlap(sunAngle, bodyAngle, angleBetween(toSun, to)) / (Math.PI * sunAngle * sunAngle);
    if (covered >= 1) return 0;
  }
  return 1 - covered;
}

/** The Sun's centre and 8 points around it at 0.7 of its radius, across the line of sight (model tests). */
export function sunDiscSamples(cameraKm: Vec3, sunKm: Vec3, sunRadiusKm: number): Vec3[] {
  const f: Vec3 = [sunKm[0] - cameraKm[0], sunKm[1] - cameraKm[1], sunKm[2] - cameraKm[2]];
  const n = Math.hypot(...f) || 1;
  const w: Vec3 = [f[0] / n, f[1] / n, f[2] / n];
  // Any vector not along w, then two axes across it.
  const a: Vec3 = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u0: Vec3 = [w[1] * a[2] - w[2] * a[1], w[2] * a[0] - w[0] * a[2], w[0] * a[1] - w[1] * a[0]];
  const un = Math.hypot(...u0);
  const u: Vec3 = [u0[0] / un, u0[1] / un, u0[2] / un];
  const v: Vec3 = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  const r = sunRadiusKm * 0.7;
  const points: Vec3[] = [sunKm];
  for (let i = 0; i < 8; i++) {
    const c = Math.cos((i * Math.PI) / 4) * r;
    const s = Math.sin((i * Math.PI) / 4) * r;
    points.push([
      sunKm[0] + u[0] * c + v[0] * s,
      sunKm[1] + u[1] * c + v[1] * s,
      sunKm[2] + u[2] * c + v[2] * s,
    ]);
  }
  return points;
}

/**
 * Strength of the glare at a distance from the Sun: the irradiance falls as 1/d², but the eye adapts, so the
 * glare fades more gently: nearly full inside Jupiter's orbit, a fifth at Neptune, ~2 % at Voyager 1.
 */
export function glarePower(sunDistanceKm: number): number {
  return 1 / (1 + (sunDistanceKm / AU_KM / 12) ** 1.5);
}
