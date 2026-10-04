import { describe, expect, it } from 'vitest';
import type { StateVector } from '../src/astro/hermite';
import { GM_KM3_S2, propagateKepler } from '../src/astro/kepler';
import { blendWeight, propagateSeries, twoBodyBetween } from '../src/astro/lagrangeSeries';
import { length, sub } from '../src/astro/vec3';

const MU = GM_KM3_S2.earth;
const leo: StateVector = { posKm: [6778, 0, 0], velKmS: [0, 7.6686 * Math.cos(0.9), 7.6686 * Math.sin(0.9)] };
const molniya: StateVector = { posKm: [6878, 0, 0], velKmS: [0, 10 * Math.cos(1.1), 10 * Math.sin(1.1)] };
const geo: StateVector = { posKm: [42_164, 0, 0], velKmS: [0, 3.0747, 0] };

/** Worst distance (km) to the exact two-body motion over several starting phases. */
function worst(
  s0: StateVector,
  f: (a: StateVector, start: number) => { got: readonly number[]; t: number }[],
): number {
  let max = 0;
  for (let start = 0; start < 6000; start += 300) {
    const a = propagateKepler(s0, start, MU);
    for (const { got, t } of f(a, start)) {
      const exact = propagateKepler(s0, t, MU).posKm;
      max = Math.max(max, length(sub(got as [number, number, number], exact)));
    }
  }
  return max;
}

describe('Lagrange f and g series', () => {
  it('extrapolates along the orbit, unlike a straight line', () => {
    // Two minutes past the last sample (a late propagation at ×10 000): a straight line climbs ~60 km.
    const straight = worst(leo, (a, start) => [
      { got: a.posKm.map((p, i) => p + (a.velKmS[i] ?? 0) * 120), t: start + 120 },
    ]);
    expect(straight).toBeGreaterThan(50);
    for (const [s0, dtS, tolKm] of [
      [leo, 120, 0.01],
      [leo, 600, 1],
      [molniya, 300, 1],
      [geo, 3600, 0.05],
    ] as const) {
      expect(worst(s0, (a, start) => [{ got: propagateSeries(a, dtS, MU), t: start + dtS }])).toBeLessThan(
        tolKm,
      );
      expect(worst(s0, (a, start) => [{ got: propagateSeries(a, -dtS, MU), t: start - dtS }])).toBeLessThan(
        tolKm,
      );
    }
  });

  it('interpolates between samples 25 minutes apart within a few kilometres in LEO', () => {
    for (const [s0, spanS, tolKm] of [
      [leo, 600, 0.05],
      [leo, 1500, 3],
      [molniya, 600, 1],
      [geo, 1800, 0.01],
    ] as const) {
      const err = worst(s0, (a, start) => {
        const b = propagateKepler(a, spanS, MU);
        return Array.from({ length: 49 }, (_, k) => {
          const t = ((k + 1) / 50) * spanS;
          return { got: twoBodyBetween(a, 0, b, spanS, t, MU), t: start + t };
        });
      });
      expect(err).toBeLessThan(tolKm);
    }
  });

  it('starts and ends exactly on the samples, and stays bounded far beyond them', () => {
    const b = propagateKepler(leo, 900, MU);
    expect(length(sub(twoBodyBetween(leo, 0, b, 900, 0, MU), leo.posKm))).toBeLessThan(1e-9);
    expect(length(sub(twoBodyBetween(leo, 0, b, 900, 900, MU), b.posKm))).toBeLessThan(1e-9);
    // A tab that slept for hours: the series is clamped, the object stays near its orbit.
    const far = propagateSeries(leo, 6 * 3600, MU);
    expect(Math.abs(length(far) - 6778)).toBeLessThan(100);
    expect(blendWeight(0)).toBe(0);
    expect(blendWeight(0.29)).toBe(0);
    expect(blendWeight(0.5)).toBeCloseTo(0.5);
    expect(blendWeight(0.71)).toBe(1);
  });
});
