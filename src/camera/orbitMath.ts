/**
 * Pure quaternion-orbit camera math (Float64, no Three.js, no DOM).
 *
 * Convention: camera position = target + orientation · (0, 0, distance). The camera looks along its
 * local −Z towards the target, local +Y is screen up, local +X is screen right — the same convention as
 * a Three.js camera, so `orientation` can be copied straight into `camera.quaternion`.
 */
import { add, cross, dot, length, lerp, normalize, scale, sub, type Vec3 } from '../astro/vec3';
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
  /**
   * Radius of the central body, for the rotation slowdown near its surface; default minDistanceKm / 1.02 (the
   * closest approach of the Earth, Moon and Mars views). The Sun keeps the camera farther (1.5 radii).
   */
  readonly surfaceRadiusKm?: number;
  /**
   * Half-size of the cube the camera never leaves (the view's maximum distance: the cube enclosing the sphere of
   * motion). Undefined: unbounded.
   */
  readonly boundsHalfKm?: number;
  /**
   * Closest approach when the pivot is not the body centre (moved with Alt + drag): the body-radius minimum
   * would forbid zooming in on a point in space; bodies stay protected by the camera obstacles.
   */
  readonly pivotMinDistanceKm?: number;
}

/** A pivot farther than this from the scene origin is a point in space, not the central body. */
const PIVOT_AT_CENTRE_KM = 1;

/** Closest camera distance for this pivot: the body minimum around the centre, `pivotMinDistanceKm` elsewhere. */
export function minDistanceFor(targetKm: Vec3, limits: OrbitLimits): number {
  return limits.pivotMinDistanceKm !== undefined && length(targetKm) > PIVOT_AT_CENTRE_KM
    ? limits.pivotMinDistanceKm
    : limits.minDistanceKm;
}

/** clampDistance with the pivot's own minimum (see `minDistanceFor`). */
export function clampDistanceAt(distanceKm: number, targetKm: Vec3, limits: OrbitLimits): number {
  return Math.min(limits.maxDistanceKm, Math.max(minDistanceFor(targetKm, limits), distanceKm));
}

/**
 * Translation for a drag with Alt held (pixels, +y down), in the camera frame: the point under the pointer at
 * the pivot's depth follows the pointer.
 */
export function panVector(
  dxPx: number,
  dyPx: number,
  distanceKm: number,
  fovYRad: number,
  viewportHeightPx: number,
): Vec3 {
  const kmPerPx = (2 * distanceKm * Math.tan(fovYRad / 2)) / Math.max(1, viewportHeightPx);
  return [-dxPx * kmPerPx, dyPx * kmPerPx, 0];
}

/** Moves the pivot (and the camera with it) by a camera-frame vector; orientation and distance unchanged. */
export function panBy(state: OrbitState, panCam: Vec3): OrbitState {
  return { ...state, targetKm: add(state.targetKm, quatRotate(state.orientation, panCam)) };
}

/** Translates the whole state (pivot and camera) by a scene-frame vector. */
function translate(state: OrbitState, deltaKm: Vec3): OrbitState {
  return { ...state, targetKm: add(state.targetKm, deltaKm) };
}

/**
 * After a pan: pivot and camera, translated together, are both kept inside the cube (the pan stops at the wall and
 * slides along it). The translation is the smallest one, per axis, that brings both back in.
 */
export function keepInCubeByTranslation(state: OrbitState, halfKm: number): OrbitState {
  const cam = cameraPositionKm(state);
  const t = state.targetKm;
  const delta = [0, 1, 2].map((i) => {
    const c = cam[i] ?? 0;
    const p = t[i] ?? 0;
    const lo = Math.max(-halfKm - c, -halfKm - p);
    const hi = Math.min(halfKm - c, halfKm - p);
    // lo > hi only for a segment longer than the cube: centre it.
    return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, 0));
  });
  return delta.every((d) => d === 0)
    ? state
    : translate(state, [delta[0] ?? 0, delta[1] ?? 0, delta[2] ?? 0]);
}

/**
 * After a zoom, a rotation or a glide, the pivot unchanged: a camera leaving the cube has its distance capped where
 * the line of sight behind it crosses the wall (zooming out stops there). Undefined when that cap would bring it
 * closer than `minDistanceKm` to the pivot, or the pivot is outside: the caller then refuses the move.
 */
export function keepInCube(state: OrbitState, halfKm: number, minDistanceKm: number): OrbitState | undefined {
  const cam = cameraPositionKm(state);
  if (Math.abs(cam[0]) <= halfKm && Math.abs(cam[1]) <= halfKm && Math.abs(cam[2]) <= halfKm) return state;
  const t = state.targetKm;
  if (Math.abs(t[0]) > halfKm || Math.abs(t[1]) > halfKm || Math.abs(t[2]) > halfKm) return undefined;
  const back = quatRotate(state.orientation, [0, 0, 1]);
  let exitKm = Infinity;
  for (let i = 0; i < 3; i++) {
    const b = back[i] ?? 0;
    const p = t[i] ?? 0;
    if (Math.abs(b) > 1e-12) exitKm = Math.min(exitKm, ((b > 0 ? halfKm : -halfKm) - p) / b);
  }
  return exitKm >= minDistanceKm ? { ...state, distanceKm: Math.min(state.distanceKm, exitKm) } : undefined;
}

/** All numbers of the state are finite (a guard against a degenerate step). */
export function isFiniteState(state: OrbitState): boolean {
  const q = state.orientation;
  return (
    state.targetKm.every(Number.isFinite) &&
    Number.isFinite(state.distanceKm) &&
    state.distanceKm > 0 &&
    [q.x, q.y, q.z, q.w].every(Number.isFinite)
  );
}

/** Distance from the camera to the nearest face of the cube (km; 0 on a face). */
export function distanceToCubeKm(cameraKm: Vec3, halfKm: number): number {
  return Math.min(
    halfKm - Math.abs(cameraKm[0]),
    halfKm - Math.abs(cameraKm[1]),
    halfKm - Math.abs(cameraKm[2]),
  );
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

/**
 * A glide (fly-to) step: distance log-lerped and orientation slerped as `interpolateOrbit`, but the pivot closes in
 * on its destination in proportion to the remaining zoom, like a zoom towards a point. With a plain lerp the camera
 * reached the object's distance while still aiming kilometres away from it: the object shrank, then grew back
 * suddenly (a zoom in–zoom out bounce). Without much zoom (a pan or a turn), the pivot moves linearly.
 */
export function flyOrbit(a: OrbitState, b: OrbitState, t: number): OrbitState {
  const s = Math.min(1, Math.max(0, t));
  const logRatio = Math.log(b.distanceKm / a.distanceKm);
  const distanceKm = a.distanceKm * Math.exp(logRatio * s);
  // Share of the pivot's path still to cover: 1 at the start, 0 at the end, following the distance.
  const left = Math.abs(logRatio) < 0.1 ? 1 - s : (distanceKm - b.distanceKm) / (a.distanceKm - b.distanceKm);
  return {
    targetKm: lerp(b.targetKm, a.targetKm, Math.min(1, Math.max(0, left))),
    distanceKm,
    orientation: quatSlerp(a.orientation, b.orientation, s),
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

/** A body the camera must stay out of (scene frame, km). */
export interface CameraObstacle {
  readonly centreKm: Vec3;
  /** Largest extent from the centre (a quick rejection bound). */
  readonly radiusKm: number;
  /** Drawn surface distance from the centre along a scene-frame unit direction (default: `radiusKm`). */
  readonly surfaceKm?: (dir: Vec3) => number;
}

/** Height of the camera above the obstacle's surface (km; negative inside). */
export function heightAboveKm(cameraKm: Vec3, o: CameraObstacle): number {
  const rel = sub(cameraKm, o.centreKm);
  const r = length(rel);
  if (r === 0) return -o.radiusKm;
  return r - (o.surfaceKm?.(scale(rel, 1 / r)) ?? o.radiusKm);
}

/**
 * Keeps the camera at least `clearanceKm` above every obstacle: a camera inside one is moved radially out to its
 * surface, and the orbit state (target unchanged) re-expressed from there, its orientation turned by the
 * smallest rotation so the roll is kept. Rotating towards the ground thus slides the camera along it.
 */
export function keepOutside(
  state: OrbitState,
  obstacles: readonly CameraObstacle[],
  clearanceKm: number,
): OrbitState {
  let s = state;
  for (const o of obstacles) {
    const cam = cameraPositionKm(s);
    const rel = sub(cam, o.centreKm);
    const r = length(rel);
    if (r >= o.radiusKm + clearanceKm || r === 0) continue;
    const dir = scale(rel, 1 / r);
    const floorKm = (o.surfaceKm?.(dir) ?? o.radiusKm) + clearanceKm;
    if (r >= floorKm) continue;
    const offset = sub(add(o.centreKm, scale(dir, floorKm)), s.targetKm);
    const distanceKm = length(offset);
    if (distanceKm === 0) continue;
    const from = quatRotate(s.orientation, [0, 0, 1]);
    const to = scale(offset, 1 / distanceKm);
    s = {
      targetKm: s.targetKm,
      distanceKm,
      orientation: quatNormalize(quatMultiply(rotationBetween(from, to), s.orientation)),
    };
  }
  return s;
}

/**
 * keepOutside for a pan: a camera pushed into an obstacle is moved out along the surface normal together with its
 * pivot (a translation, no re-aiming), so panning into a planet slides along it.
 */
export function keepOutsideByTranslation(
  state: OrbitState,
  obstacles: readonly CameraObstacle[],
  clearanceKm: number,
): OrbitState {
  let s = state;
  for (const o of obstacles) {
    const rel = sub(cameraPositionKm(s), o.centreKm);
    const r = length(rel);
    if (r >= o.radiusKm + clearanceKm || r === 0) continue;
    const dir = scale(rel, 1 / r);
    const floorKm = (o.surfaceKm?.(dir) ?? o.radiusKm) + clearanceKm;
    if (r < floorKm) s = translate(s, scale(dir, floorKm - r));
  }
  return s;
}

/** Smallest rotation taking unit vector `a` to unit vector `b`. */
function rotationBetween(a: Vec3, b: Vec3): Quat {
  const c = dot(a, b);
  if (c < -0.999999) {
    // Opposite: half a turn about any perpendicular axis.
    const axis = normalize(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
    return { x: axis[0], y: axis[1], z: axis[2], w: 0 };
  }
  const v = cross(a, b);
  return quatNormalize({ x: v[0], y: v[1], z: v[2], w: 1 + c });
}
