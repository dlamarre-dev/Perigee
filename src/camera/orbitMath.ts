/**
 * Pure quaternion-orbit camera math (Float64, no Three.js, no DOM).
 *
 * Convention: camera position = target + orientation · (0, 0, distance). The camera looks along its
 * local −Z towards the target, local +Y is screen up, local +X is screen right — the same convention as
 * a Three.js camera, so `orientation` can be copied straight into `camera.quaternion`.
 */
import { add, cross, lerp, normalize, scale, type Vec3 } from '../astro/vec3';

export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export const QUAT_IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatNorm(q: Quat): number {
  return Math.hypot(q.x, q.y, q.z, q.w);
}

export function quatNormalize(q: Quat): Quat {
  const n = quatNorm(q);
  if (n === 0 || !Number.isFinite(n)) return QUAT_IDENTITY;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

/** Rotation of angleRad about a unit axis. */
export function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const h = angleRad / 2;
  const s = Math.sin(h);
  return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(h) };
}

/** Rotates vector v by unit quaternion q. */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w(u × v) + 2u × (u × v), with u = (x, y, z)
  const u: Vec3 = [q.x, q.y, q.z];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q.w)), cross(u, t));
}

export function quatDot(a: Quat, b: Quat): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

/** Shortest-path spherical interpolation between unit quaternions. */
export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let d = quatDot(a, b);
  let bb = b;
  if (d < 0) {
    d = -d;
    bb = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }
  if (d > 0.9995) {
    return quatNormalize({
      x: a.x + (bb.x - a.x) * t,
      y: a.y + (bb.y - a.y) * t,
      z: a.z + (bb.z - a.z) * t,
      w: a.w + (bb.w - a.w) * t,
    });
  }
  const theta = Math.acos(d);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return {
    x: a.x * wa + bb.x * wb,
    y: a.y * wa + bb.y * wb,
    z: a.z * wa + bb.z * wb,
    w: a.w * wa + bb.w * wb,
  };
}

/** Angle (rad) of the rotation taking a to b. */
export function quatAngleBetween(a: Quat, b: Quat): number {
  return 2 * Math.acos(Math.min(1, Math.abs(quatDot(a, b))));
}

/** Quaternion of the rotation matrix whose columns are the given orthonormal axes. */
export function quatFromBasis(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Quat {
  const [m00, m10, m20] = xAxis;
  const [m01, m11, m21] = yAxis;
  const [m02, m12, m22] = zAxis;
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = { w: 0.25 / s, x: (m21 - m12) * s, y: (m02 - m20) * s, z: (m10 - m01) * s };
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s };
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s };
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
  }
  return quatNormalize(q);
}

export interface OrbitState {
  readonly targetKm: Vec3;
  readonly distanceKm: number;
  readonly orientation: Quat;
}

export interface OrbitLimits {
  readonly minDistanceKm: number;
  readonly maxDistanceKm: number;
}

export function cameraPositionKm(state: OrbitState): Vec3 {
  return add(state.targetKm, quatRotate(state.orientation, [0, 0, state.distanceKm]));
}

/**
 * Orbit state seeing `targetKm` from `directionFromTarget` (any length), with `up` projected to screen up.
 * If `up` is (nearly) parallel to the direction, an arbitrary perpendicular up is used instead.
 */
export function orbitStateLookingFrom(
  targetKm: Vec3,
  directionFromTarget: Vec3,
  up: Vec3,
  distanceKm: number,
): OrbitState {
  const zAxis = normalize(directionFromTarget);
  let side = cross(up, zAxis);
  if (Math.hypot(side[0], side[1], side[2]) < 1e-6) {
    side = cross(Math.abs(zAxis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], zAxis);
  }
  const xAxis = normalize(side);
  const yAxis = cross(zAxis, xAxis);
  return { targetKm, distanceKm, orientation: quatFromBasis(xAxis, yAxis, zAxis) };
}

/** orientation ← normalize(orientation · q(axisCam, angle)), axis expressed in the camera frame. */
export function rotateLocal(state: OrbitState, axisCam: Vec3, angleRad: number): OrbitState {
  if (angleRad === 0) return state;
  const orientation = quatNormalize(quatMultiply(state.orientation, quatFromAxisAngle(axisCam, angleRad)));
  return { ...state, orientation };
}

/**
 * Arcball rotation for a screen drag (pixels, +y down). The axis (Δy, Δx, 0) is taken in the camera frame
 * with signs chosen so the body follows the pointer. Returns the rotation vector (axis × angle).
 */
export function arcballRotationVector(dxPx: number, dyPx: number, radPerPx: number): Vec3 {
  return [-dyPx * radPerPx, -dxPx * radPerPx, 0];
}

/** Applies a rotation vector (axis × angle, camera frame). */
export function rotateByVector(state: OrbitState, rotationVector: Vec3): OrbitState {
  const angleRad = Math.hypot(rotationVector[0], rotationVector[1], rotationVector[2]);
  if (angleRad < 1e-15) return state;
  return rotateLocal(state, scale(rotationVector, 1 / angleRad), angleRad);
}

/** Roll about the view axis (camera Z). Positive angle rolls the scene counter-clockwise on screen. */
export function roll(state: OrbitState, angleRad: number): OrbitState {
  return rotateLocal(state, [0, 0, 1], -angleRad);
}

export function clampDistance(distanceKm: number, limits: OrbitLimits): number {
  return Math.min(limits.maxDistanceKm, Math.max(limits.minDistanceKm, distanceKm));
}

/** Logarithmic zoom: distance ← distance · exp(k·Δ), clamped. Positive Δ zooms out. */
export function zoomLog(state: OrbitState, kDelta: number, limits: OrbitLimits): OrbitState {
  return { ...state, distanceKm: clampDistance(state.distanceKm * Math.exp(kDelta), limits) };
}

/** Interpolates two states: lerp target, log-lerp distance, slerp orientation. */
export function interpolateOrbit(a: OrbitState, b: OrbitState, t: number): OrbitState {
  return {
    targetKm: lerp(a.targetKm, b.targetKm, t),
    distanceKm: Math.exp(Math.log(a.distanceKm) + (Math.log(b.distanceKm) - Math.log(a.distanceKm)) * t),
    orientation: quatSlerp(a.orientation, b.orientation, t),
  };
}

export function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
