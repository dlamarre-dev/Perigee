import { describe, expect, it } from 'vitest';
import { dot, length, normalize, sub, type Vec3 } from '../src/astro/vec3';
import {
  QUAT_IDENTITY,
  arcballRotationVector,
  cameraPositionKm,
  easeDistanceKm,
  flyOrbit,
  heightAboveKm,
  interpolateOrbit,
  clampDistanceAt,
  distanceToCubeKm,
  isFiniteState,
  keepInCube,
  keepInCubeByTranslation,
  keepOutside,
  keepOutsideByTranslation,
  orbitStateLookingFrom,
  panBy,
  panVector,
  quatAngleBetween,
  quatFromAxisAngle,
  quatNorm,
  quatRotate,
  roll,
  rotateByVector,
  rotateLocal,
  twistRollRad,
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

describe('smooth zoom and touch twist', () => {
  it('eases towards the requested distance without overshoot, within 1 % after about 0.6 s', () => {
    // Five +/− key steps at once (×e^0.75).
    const target = 100;
    let d = 100 * Math.exp(0.75);
    let prev = d;
    let elapsed = 0;
    while (d !== target && elapsed < 5) {
      d = easeDistanceKm(d, target, 1 / 60, 0.12);
      expect(d).toBeLessThanOrEqual(prev);
      expect(d).toBeGreaterThanOrEqual(target);
      prev = d;
      elapsed += 1 / 60;
      if (Math.abs(elapsed - 0.6) < 1 / 120) expect(d / target - 1).toBeLessThan(0.01);
    }
    expect(d).toBe(target);
  });

  it('zooms out the same way', () => {
    let d = 10;
    for (let i = 0; i < 120; i++) d = easeDistanceKm(d, 20, 1 / 60, 0.12);
    expect(d).toBe(20);
  });

  it('ignores small twists and rolls continuously past the dead zone', () => {
    const dead = (6 * Math.PI) / 180;
    expect(twistRollRad(dead * 0.9, dead, 0.6)).toBe(0);
    expect(twistRollRad(-dead * 0.9, dead, 0.6)).toBe(0);
    expect(twistRollRad(dead + 0.1, dead, 0.6)).toBeCloseTo(0.06, 12);
    expect(twistRollRad(-(dead + 0.1), dead, 0.6)).toBeCloseTo(-0.06, 12);
  });
});

describe('keepOutside', () => {
  const mars = 3389.5;
  const ground = { centreKm: [0, 0, 0] as Vec3, radiusKm: mars };
  // Following a rover on the +X surface, 8 m away.
  const rover: Vec3 = [mars + 0.001, 0, 0];

  it('leaves a camera above the ground untouched', () => {
    const s = orbitStateLookingFrom(rover, [1, 0, 0], [0, 0, 1], 0.008);
    expect(keepOutside(s, [ground], 0.002)).toBe(s);
  });

  it('lifts a camera that went under the ground back onto it, keeping the target', () => {
    // Looking up at the rover from below the surface.
    const s = orbitStateLookingFrom(rover, normalize([-1, 0.3, 0]), [0, 0, 1], 0.008);
    expect(heightAboveKm(cameraPositionKm(s), ground)).toBeLessThan(0);
    const out = keepOutside(s, [ground], 0.002);
    expect(out.targetKm).toEqual(rover);
    expect(heightAboveKm(cameraPositionKm(out), ground)).toBeCloseTo(0.002, 9);
    expect(quatNorm(out.orientation)).toBeCloseTo(1, 12);
  });

  it('uses the drawn surface when given, and every obstacle', () => {
    const lowGround = { ...ground, surfaceKm: () => mars - 0.4 };
    const moon = { centreKm: [0, 5000, 0] as Vec3, radiusKm: 100 };
    const s = orbitStateLookingFrom([0, 4950, 0], [0, 1, 0], [0, 0, 1], 60);
    const out = keepOutside(s, [lowGround, moon], 0.002);
    expect(length(sub(cameraPositionKm(out), moon.centreKm))).toBeCloseTo(100.002, 6);
    const under = orbitStateLookingFrom([mars - 0.3, 0, 0], [1, 0, 0], [0, 0, 1], 0.05);
    expect(keepOutside(under, [lowGround], 0)).toBe(under);
  });
});

describe('pan (Alt + drag) and the cube bound', () => {
  const fov = (45 * Math.PI) / 180;

  it('the point under the pointer at the pivot depth follows the pointer', () => {
    // Camera frame: dragging right moves the camera left (−x), so the scene follows the pointer.
    const heightPx = 800;
    const v = panVector(100, 0, 4 * R, fov, heightPx);
    const kmPerPx = (2 * 4 * R * Math.tan(fov / 2)) / heightPx;
    expect(v[0]).toBeCloseTo(-100 * kmPerPx, 9);
    expect(v[1]).toBe(0);
    // Dragging down moves the camera up (+y in the camera frame).
    expect(panVector(0, 50, 4 * R, fov, heightPx)[1]).toBeGreaterThan(0);
  });

  it('panBy moves pivot and camera together, orientation and distance unchanged', () => {
    const moved = panBy(equatorView, [100, -50, 0]);
    expect(moved.distanceKm).toBe(equatorView.distanceKm);
    expect(moved.orientation).toBe(equatorView.orientation);
    const shift = sub(cameraPositionKm(moved), cameraPositionKm(equatorView));
    expect(length(shift)).toBeCloseTo(Math.hypot(100, 50), 9);
    expect(length(sub(moved.targetKm, equatorView.targetKm))).toBeCloseTo(Math.hypot(100, 50), 9);
  });

  it('many pans keep a unit quaternion', () => {
    let s = equatorView;
    for (let i = 0; i < 100_000; i++) s = panBy(s, [Math.sin(i), Math.cos(i), 0]);
    expect(quatNorm(s.orientation)).toBeCloseTo(1, 12);
  });

  it('a pan stops at the cube wall and slides along it, pivot and camera both inside', () => {
    const half = 10 * R;
    for (const pan of [
      [20 * R, 20 * R, 0],
      [-30 * R, 5 * R, 0],
      [0, -40 * R, 0],
    ] as Vec3[]) {
      const s = keepInCubeByTranslation(panBy(equatorView, pan), half);
      for (const p of [cameraPositionKm(s), s.targetKm]) {
        for (const c of p) expect(Math.abs(c)).toBeLessThanOrEqual(half * (1 + 1e-12));
      }
      expect(s.distanceKm).toBe(equatorView.distanceKm);
    }
    const s = keepInCubeByTranslation(panBy(equatorView, [20 * R, 20 * R, 0]), half);
    expect(distanceToCubeKm(cameraPositionKm(s), half)).toBeCloseTo(0, 6);
  });

  it('zooming out round an off-centre pivot is capped at the wall, the pivot never moved', () => {
    const half = 10 * R;
    const off = { ...equatorView, targetKm: [5 * R, 0, 0] as Vec3, distanceKm: 50 * R };
    const capped = keepInCube(off, half, 10);
    // Looking along −x from +x: the wall at +10 R is 5 R behind the pivot.
    expect(capped?.distanceKm).toBeCloseTo(5 * R, 6);
    expect(capped?.targetKm).toBe(off.targetKm);
    const inside = { ...off, distanceKm: 2 * R };
    expect(keepInCube(inside, half, 10)).toBe(inside);
  });

  it('a move that would need a distance below the minimum is refused, never a zero distance', () => {
    const half = 10 * R;
    // Pivot on the wall, camera behind it outside the cube (the case that gave NaN).
    const onWall = { ...equatorView, targetKm: [half, 0, 0] as Vec3, distanceKm: 3 * R };
    expect(keepInCube(onWall, half, 10)).toBeUndefined();
    const outsidePivot = { ...equatorView, targetKm: [2 * half, 0, 0] as Vec3 };
    expect(keepInCube(outsidePivot, half, 10)).toBeUndefined();
    expect(isFiniteState({ ...equatorView, distanceKm: 0 })).toBe(false);
    expect(isFiniteState({ ...equatorView, targetKm: [NaN, 0, 0] })).toBe(false);
    expect(isFiniteState(equatorView)).toBe(true);
  });

  it('panning into a body pushes the camera out by translation, the view not re-aimed', () => {
    const earth = { centreKm: [0, 0, 0] as Vec3, radiusKm: R };
    const into = { ...equatorView, targetKm: [-3.5 * R, 0, 0] as Vec3 };
    const out = keepOutsideByTranslation(into, [earth], 0.002);
    expect(length(cameraPositionKm(out))).toBeCloseTo(R + 0.002, 6);
    expect(out.orientation).toBe(into.orientation);
    expect(out.distanceKm).toBe(into.distanceKm);
  });

  it('around a point in space the pivot minimum replaces the body minimum', () => {
    const l = { ...limits, pivotMinDistanceKm: 10 };
    expect(clampDistanceAt(1, [0, 0, 0], l)).toBe(limits.minDistanceKm);
    expect(clampDistanceAt(1, [2 * R, 0, 0], l)).toBe(10);
    expect(clampDistanceAt(1e12, [2 * R, 0, 0], l)).toBe(limits.maxDistanceKm);
  });
});

describe('glide towards a followed object', () => {
  it('ends exactly on the destination and keeps the object at a steady angle while zooming in', () => {
    const from = equatorView;
    // An object 6 800 km from the centre, reached at 0.27 km (the ISS's model distance).
    const objectKm: Vec3 = [0, 6800, 0];
    const to = orbitStateLookingFrom(objectKm, [0, 1, 0], [0, 0, 1], 0.27);
    const end = flyOrbit(from, to, 1);
    expect(end.distanceKm).toBeCloseTo(0.27, 12);
    expect(length(sub(end.targetKm, objectKm))).toBeLessThan(1e-9);
    expect(flyOrbit(from, to, 0).targetKm).toEqual(from.targetKm);
    // Seen from the camera, the object's offset from the pivot never grows relative to the distance (with a plain
    // lerp it reached ~30 000 times the distance near the end: the object shrank, then jumped back).
    let previousRatio = Infinity;
    for (let i = 0; i <= 200; i++) {
      const s = flyOrbit(from, to, i / 200);
      const ratio = length(sub(s.targetKm, objectKm)) / s.distanceKm;
      expect(ratio).toBeLessThanOrEqual(previousRatio * (1 + 1e-9));
      previousRatio = ratio;
    }
  });

  it('moves the pivot linearly when the distance barely changes (a pan or a turn)', () => {
    const to = { ...equatorView, targetKm: [100, 0, 0] as Vec3 };
    expect(flyOrbit(equatorView, to, 0.5).targetKm[0]).toBeCloseTo(50, 9);
  });
});
