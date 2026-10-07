/**
 * Pure quaternion-orbit camera math (Float64, no Three.js, no DOM).
 *
 * Convention: camera position = target + orientation · (0, 0, distance). The camera looks along its
 * local −Z towards the target, local +Y is screen up, local +X is screen right — the same convention as
 * a Three.js camera, so `orientation` can be copied straight into `camera.quaternion`.
 */
import { add, cross, lerp, normalize, scale, type Vec3 } from '../astro/vec3';
import {
  QUAT_IDENTITY,
  quatAngleBetween,
  quatConjugate,
  quatDot,
  quatFromAxisAngle,
  quatFromBasis,
  quatMultiply,
  quatNorm,
  quatNormalize,
  quatRotate,
  quatSlerp,
  type Quat,
} from '../astro/quat';

export {
  QUAT_IDENTITY,
  quatAngleBetween,
  quatConjugate,
  quatDot,
  quatFromAxisAngle,
  quatFromBasis,
  quatMultiply,
  quatNorm,
  quatNormalize,
  quatRotate,
  quatSlerp,
  type Quat,
};

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

/**
 * One frame of smooth zoom: the distance eases towards the target in log space with time constant `tauS`
 * (exponential, so it never overshoots). Returns the target once within 0.01 % of it.
 */
export function easeDistanceKm(currentKm: number, targetKm: number, dtS: number, tauS: number): number {
  if (tauS <= 0) return targetKm;
  const k = 1 - Math.exp(-dtS / tauS);
  const next = Math.exp(Math.log(currentKm) + (Math.log(targetKm) - Math.log(currentKm)) * k);
  return Math.abs(next / targetKm - 1) < 1e-4 ? targetKm : next;
}

/**
 * Roll for a two-finger twist with a dead zone: nothing until the accumulated twist exceeds `deadRad`, then
 * `gain` times the excess (continuous at the threshold), so a pinch alone does not roll the view.
 */
export function twistRollRad(accumulatedRad: number, deadRad: number, gain: number): number {
  const excess = Math.abs(accumulatedRad) - deadRad;
  return excess > 0 ? Math.sign(accumulatedRad) * excess * gain : 0;
}

/**
 * Following a celestial body (planet, dwarf planet, moon) frames it at this many radii: with the 45° field of
 * view its disc fills about a quarter of the screen height, the same in every view.
 */
export const BODY_FOLLOW_RADII = 10;

/** Follow distance and closest approach for a celestial body of the given radius. */
export function bodyFollow(radiusKm: number): {
  distanceKm: number;
  minDistanceKm: number;
  surfaceRadiusKm: number;
} {
  return {
    distanceKm: radiusKm * BODY_FOLLOW_RADII,
    minDistanceKm: radiusKm * 1.05,
    surfaceRadiusKm: radiusKm,
  };
}
