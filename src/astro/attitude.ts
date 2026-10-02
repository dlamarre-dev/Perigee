/**
 * Illustrative attitude of a spacecraft model (pure): the published models carry no attitude, so a model axis
 * is pointed at a target (the Earth for the high-gain antenna, the ground for rovers and Earth-observing
 * satellites) and a second axis as close as possible to another direction (the Sun, the velocity, north).
 */
import { quatConjugate, quatFromBasis, quatMultiply, type Quat } from './quat';
import { cross, dot, normalize, scale, sub, type Vec3 } from './vec3';

export type AxisName = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export function axisVector(a: AxisName): Vec3 {
  const s = a[0] === '-' ? -1 : 1;
  return a[1] === 'x' ? [s, 0, 0] : a[1] === 'y' ? [0, s, 0] : [0, 0, s];
}

/** Orthonormal basis (primary, secondary ⟂, primary × secondary), or undefined when the two are parallel. */
function basis(primary: Vec3, secondary: Vec3): [Vec3, Vec3, Vec3] | undefined {
  const p = normalize(primary);
  const s = sub(secondary, scale(p, dot(secondary, p)));
  if (Math.hypot(s[0], s[1], s[2]) < 1e-9) return undefined;
  const q = normalize(s);
  return [p, q, cross(p, q)];
}

/**
 * Rotation (model → scene) taking `primaryAxis` onto `primaryDir` and `secondaryAxis` as close as possible to
 * `secondaryDir`. Falls back to any perpendicular when the secondary direction is parallel to the primary.
 */
export function alignAxes(
  primaryAxis: Vec3,
  primaryDir: Vec3,
  secondaryAxis: Vec3,
  secondaryDir: Vec3,
): Quat {
  const model = basis(primaryAxis, secondaryAxis);
  const fallback: Vec3 = Math.abs(normalize(primaryDir)[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const world = basis(primaryDir, secondaryDir) ?? basis(primaryDir, fallback);
  if (!model || !world) return { x: 0, y: 0, z: 0, w: 1 };
  const m = quatFromBasis(model[0], model[1], model[2]);
  const w = quatFromBasis(world[0], world[1], world[2]);
  return quatMultiply(w, quatConjugate(m));
}
