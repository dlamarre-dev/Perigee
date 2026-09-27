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
  return iauOrientationEqj(axis.ra * 15 * DEG_TO_RAD, axis.dec * DEG_TO_RAD, axis.spin * DEG_TO_RAD);
}

/** EQJ ← body-fixed from pole right ascension/declination and prime-meridian angle W. */
export function iauOrientationEqj(raRad: number, decRad: number, wRad: number): Quat {
  const qa = quatFromAxisAngle([0, 0, 1], raRad + Math.PI / 2);
  const qb = quatFromAxisAngle([1, 0, 0], Math.PI / 2 - decRad);
  const qc = quatFromAxisAngle([0, 0, 1], wRad);
  return quatMultiply(quatMultiply(qa, qb), qc);
}

/**
 * Ceres, IAU WGCCRE 2015 (Archinal et al. 2018): α₀ = 291.418°, δ₀ = 66.764°, W = 170.650° + 952.1532° d, with
 * d = days from J2000 TDB. Prime meridian defined by crater Kait (Dawn team longitudes, as the Dawn mosaic).
 */
export function ceresOrientationEqj(tdbJd: number): Quat {
  const d = tdbJd - 2_451_545.0;
  const wDeg = (170.65 + 952.1532 * d) % 360;
  return iauOrientationEqj(291.418 * DEG_TO_RAD, 66.764 * DEG_TO_RAD, wDeg * DEG_TO_RAD);
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

/** Sun centre as seen from the Mars centre, EQJ, km (geometric). */
export function marsToSunKm(date: Date): Vec3 {
  const v = Astronomy.HelioVector(Astronomy.Body.Mars, date);
  return [-v.x * AU_KM, -v.y * AU_KM, -v.z * AU_KM];
}
