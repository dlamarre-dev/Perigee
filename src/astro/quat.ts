/**
 * Unit quaternions (Float64, pure). Shared by the astro frames and the camera controller.
 * Convention: Hamilton product, v' = q · v · q*.
 */
import { add, cross, scale, type Vec3 } from './vec3';

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

export function quatConjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}
