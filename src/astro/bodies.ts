/**
 * Central-body orientation and positions (pure wrappers around astronomy-engine).
 * Frames: EQJ = ICRF-aligned J2000 equatorial; body-fixed frames follow the IAU WGCCRE rotation models.
 */
import { Astronomy } from './astronomy';
import { AU_KM, DEG_TO_RAD } from './constants';
import { quatFromAxisAngle, quatMultiply, type Quat } from './quat';
import { gmstRad } from './time';
import { scale, sub, type Vec3 } from './vec3';

/** IAU mean radii (km). */
export const MOON_RADIUS_KM = 1737.4;
export const MARS_RADIUS_KM = 3389.5;

/**
 * Orientation EQJ ← body-fixed for an IAU rotation model: M = Rz(α₀ + 90°) · Rx(90° − δ₀) · Rz(W).
 * For the Moon, astronomy-engine implements the IAU model (close to the Mean Earth/polar axis frame used
 * for LROC coordinates; differences are well below visual resolution).
 */
export function bodyOrientationEqj(body: Astronomy.Body, date: Date): Quat {
  const axis = Astronomy.RotationAxis(body, date);
  const raRad = axis.ra * 15 * DEG_TO_RAD;
  const decRad = axis.dec * DEG_TO_RAD;
  const wRad = axis.spin * DEG_TO_RAD;
  const qa = quatFromAxisAngle([0, 0, 1], raRad + Math.PI / 2);
  const qb = quatFromAxisAngle([1, 0, 0], Math.PI / 2 - decRad);
  const qc = quatFromAxisAngle([0, 0, 1], wRad);
  return quatMultiply(quatMultiply(qa, qb), qc);
}

/** Moon centre relative to the Earth centre, EQJ, km. */
export function geoMoonKm(date: Date): Vec3 {
  const v = Astronomy.GeoMoon(date);
  return [v.x * AU_KM, v.y * AU_KM, v.z * AU_KM];
}

/** Sun centre relative to the Earth centre, EQJ, km (geometric). */
export function geoSunKm(date: Date): Vec3 {
  const v = Astronomy.GeoVector(Astronomy.Body.Sun, date, false);
  return [v.x * AU_KM, v.y * AU_KM, v.z * AU_KM];
}

/** Earth centre as seen from the Moon centre, EQJ, km. */
export function moonToEarthKm(date: Date): Vec3 {
  return scale(geoMoonKm(date), -1);
}

/** Sun centre as seen from the Moon centre, EQJ, km. */
export function moonToSunKm(date: Date): Vec3 {
  return sub(geoSunKm(date), geoMoonKm(date));
}

/**
 * Earth body-fixed ← inertial: rotation by GMST about the pole. The inertial frame is TEME for satellites;
 * treating it as EQJ elsewhere (Earth seen from the Moon) neglects precession (≈ 0.36° in 2026).
 */
export function earthOrientation(date: Date): Quat {
  return quatFromAxisAngle([0, 0, 1], gmstRad(date));
}
