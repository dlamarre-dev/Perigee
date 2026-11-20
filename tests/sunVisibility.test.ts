import { describe, expect, it } from 'vitest';
import { discOverlap, glarePower, sunDiscSamples, sunDiscVisible } from '../src/render/sunVisibility';

const AU = 149_597_870.7;
const SUN_R = 695_700;

describe('Sun disc visibility', () => {
  it('computes disc overlaps (apart, contained, half)', () => {
    expect(discOverlap(1, 1, 3)).toBe(0);
    expect(discOverlap(1, 3, 0.5)).toBeCloseTo(Math.PI, 9);
    // Two unit discs one radius apart: 2π/3 − √3/2.
    expect(discOverlap(1, 1, 1)).toBeCloseTo((2 * Math.PI) / 3 - Math.sqrt(3) / 2, 9);
  });

  it('is whole with nothing in front, nil behind a body covering it', () => {
    const camera: [number, number, number] = [AU, 0, 0];
    expect(sunDiscVisible(camera, [0, 0, 0], SUN_R, [])).toBe(1);
    // The Earth seen from 10 000 km beyond it, on the Sun line: far larger than the Sun.
    const earth = { centreKm: [AU - 10_000, 0, 0] as [number, number, number], radiusKm: 6371 };
    expect(sunDiscVisible(camera, [0, 0, 0], SUN_R, [earth])).toBe(0);
    // A body behind the camera or beyond the Sun does not count.
    const behind = { centreKm: [AU + 10_000, 0, 0] as [number, number, number], radiusKm: 6371 };
    const beyond = { centreKm: [-AU, 0, 0] as [number, number, number], radiusKm: 70_000 };
    expect(sunDiscVisible(camera, [0, 0, 0], SUN_R, [behind, beyond])).toBe(1);
  });

  it('dims smoothly as a body covers part of the disc', () => {
    const camera: [number, number, number] = [AU, 0, 0];
    // A body as large as the Sun on the sky, offset by one apparent radius.
    const d = AU / 2;
    const r = SUN_R / 2;
    const offset = (SUN_R / AU) * d;
    const v = sunDiscVisible(camera, [0, 0, 0], SUN_R, [{ centreKm: [AU - d, offset, 0], radiusKm: r }]);
    expect(v).toBeGreaterThan(0.55);
    expect(v).toBeLessThan(0.65);
  });

  it('samples the disc across the line of sight', () => {
    const pts = sunDiscSamples([AU, 0, 0], [0, 0, 0], SUN_R);
    expect(pts).toHaveLength(9);
    for (const p of pts.slice(1)) {
      expect(p[0]).toBeCloseTo(0, 6);
      expect(Math.hypot(p[1], p[2])).toBeCloseTo(SUN_R * 0.7, 3);
    }
  });

  it('fades the glare with the distance from the Sun', () => {
    expect(glarePower(AU)).toBeGreaterThan(0.95);
    expect(glarePower(30 * AU)).toBeLessThan(0.25);
    expect(glarePower(170 * AU)).toBeLessThan(0.03);
  });
});
