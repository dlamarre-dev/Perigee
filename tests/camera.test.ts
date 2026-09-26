import { describe, expect, it } from 'vitest';
import { dot, length, normalize, sub, type Vec3 } from '../src/astro/vec3';
import {
  QUAT_IDENTITY,
  arcballRotationVector,
  cameraPositionKm,
  interpolateOrbit,
  orbitStateLookingFrom,
  quatAngleBetween,
  quatFromAxisAngle,
  quatNorm,
  quatRotate,
  roll,
  rotateByVector,
  rotateLocal,
  zoomLog,
  type OrbitState,
} from '../src/camera/orbitMath';

const R = 6378.137;
const limits = { minDistanceKm: R * 1.02, maxDistanceKm: R * 100 };
const equatorView: OrbitState = orbitStateLookingFrom([0, 0, 0], [1, 0, 0], [0, 0, 1], 4 * R);

function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.min(1, Math.max(-1, dot(normalize(a), normalize(b)))));
}

describe('quaternion orbit camera', () => {
  it('orbitStateLookingFrom places the camera on the requested side with north up', () => {
    const pos = cameraPositionKm(equatorView);
    expect(pos[0]).toBeCloseTo(4 * R, 6);
    expect(Math.hypot(pos[1], pos[2])).toBeLessThan(1e-9);
    const screenUp = quatRotate(equatorView.orientation, [0, 1, 0]);
    expect(screenUp[2]).toBeCloseTo(1, 12);
  });

  it('orbitStateLookingFrom copes with up parallel to the view direction (over a pole)', () => {
    const s = orbitStateLookingFrom([0, 0, 7000], [0, 0, 1], [0, 0, 1], 1000);
    expect(Object.values(s.orientation).every(Number.isFinite)).toBe(true);
    expect(cameraPositionKm(s)[2]).toBeCloseTo(8000, 6);
  });

  it('does not drift after 10⁶ small rotations', () => {
    const axis = normalize([0.3, -0.8, 0.52]);
    const stepRad = 1e-4;
    const steps = 1_000_000;
    let s = equatorView;
    for (let i = 0; i < steps; i++) s = rotateLocal(s, axis, stepRad);

    expect(Math.abs(quatNorm(s.orientation) - 1)).toBeLessThan(1e-12);
    const expected = rotateLocal(equatorView, axis, stepRad * steps);
    expect(quatAngleBetween(s.orientation, expected.orientation)).toBeLessThan(1e-6);
  });

  it('keeps unit norm under random mixed rotations', () => {
    let s = equatorView;
    let seed = 42;
    const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31) * 2 - 1;
    for (let i = 0; i < 200_000; i++) s = rotateByVector(s, [rand() * 0.01, rand() * 0.01, rand() * 0.01]);
    expect(Math.abs(quatNorm(s.orientation) - 1)).toBeLessThan(1e-12);
  });

  it('passes over the poles continuously, without NaN or jumps', () => {
    const stepRad = Math.PI / 180;
    let s = equatorView;
    let prev = cameraPositionKm(s);
    let maxZ = -Infinity;
    for (let i = 0; i < 360; i++) {
      s = rotateByVector(s, arcballRotationVector(0, 1, stepRad)); // drag down 1 px at 1°/px
      const pos = cameraPositionKm(s);
      expect(pos.every(Number.isFinite)).toBe(true);
      expect(angleBetween(prev, pos)).toBeCloseTo(stepRad, 9);
      expect(length(pos)).toBeCloseTo(4 * R, 6);
      maxZ = Math.max(maxZ, pos[2]);
      prev = pos;
    }
    // The camera went exactly over a pole and came back home.
    expect(maxZ).toBeCloseTo(4 * R, 6);
    expect(quatAngleBetween(s.orientation, equatorView.orientation)).toBeLessThan(1e-9);
  });

  it('dragging down moves the camera towards the north (body follows the pointer)', () => {
    const s = rotateByVector(equatorView, arcballRotationVector(0, 10, 0.01));
    expect(cameraPositionKm(s)[2]).toBeGreaterThan(0);
  });

  it('dragging right moves the camera west (body follows the pointer)', () => {
    const s = rotateByVector(equatorView, arcballRotationVector(10, 0, 0.01));
    expect(cameraPositionKm(s)[1]).toBeLessThan(0);
  });

  it('roll keeps the view direction and camera position', () => {
    const s = roll(equatorView, 0.7);
    const before = cameraPositionKm(equatorView);
    const after = cameraPositionKm(s);
    expect(length(sub(before, after))).toBeLessThan(1e-9);
    const up = quatRotate(s.orientation, [0, 1, 0]);
    expect(Math.acos(up[2])).toBeCloseTo(0.7, 12);
  });

  it('zooms logarithmically and respects bounds', () => {
    const zin = zoomLog(equatorView, Math.log(0.5), limits);
    expect(zin.distanceKm).toBeCloseTo(2 * R, 9);
    expect(zoomLog(equatorView, -100, limits).distanceKm).toBe(limits.minDistanceKm);
    expect(zoomLog(equatorView, 100, limits).distanceKm).toBe(limits.maxDistanceKm);
  });

  it('interpolates fly-to endpoints exactly and distance geometrically', () => {
    const to: OrbitState = {
      targetKm: [1000, 0, 0],
      distanceKm: 16 * R,
      orientation: quatFromAxisAngle([0, 0, 1], 1),
    };
    const mid = interpolateOrbit(equatorView, to, 0.5);
    expect(mid.distanceKm).toBeCloseTo(8 * R, 6);
    expect(quatAngleBetween(interpolateOrbit(equatorView, to, 1).orientation, to.orientation)).toBeLessThan(
      1e-12,
    );
    expect(quatAngleBetween(interpolateOrbit(equatorView, to, 0).orientation, QUAT_IDENTITY)).toBeCloseTo(
      quatAngleBetween(equatorView.orientation, QUAT_IDENTITY),
      12,
    );
  });
});
