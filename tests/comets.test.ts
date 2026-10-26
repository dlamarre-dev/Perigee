import { describe, expect, it } from 'vitest';
import {
  asteroidMagnitude,
  conicOffsetsAround,
  cometMagnitude,
  perihelionPassages,
} from '../src/astro/comets';
import { GM_KM3_S2, osculatingElements, propagateKepler } from '../src/astro/kepler';
import type { StateVector } from '../src/astro/hermite';
import { length } from '../src/astro/vec3';

const AU = 149_597_870.7;
const MU = GM_KM3_S2.sun;
const DAY = 86_400;

/** State at perihelion of a conic with perihelion distance q and eccentricity e (perihelion on +x, plane xy). */
function atPerihelion(qKm: number, e: number): StateVector {
  return { posKm: [qKm, 0, 0], velKmS: [0, Math.sqrt((MU * (1 + e)) / qKm), 0] };
}

const point = (o: Float64Array, s: StateVector, i: number): [number, number, number] => [
  s.posKm[0] + (o[i * 3] ?? 0),
  s.posKm[1] + (o[i * 3 + 1] ?? 0),
  s.posKm[2] + (o[i * 3 + 2] ?? 0),
];

describe('comet orbits', () => {
  it('draws a highly eccentric ellipse through the comet, closed, smooth at perihelion', () => {
    const peri = atPerihelion(0.586 * AU, 0.967); // Halley-like
    const now = propagateKepler(peri, 20 * 365.25 * DAY, MU);
    const o = conicOffsetsAround(now, MU, 1e-6);
    const n = o.length / 3;
    // Passes through the comet (one offset is zero) and closes on itself.
    let minOffset = Infinity;
    for (let i = 0; i < n; i++)
      minOffset = Math.min(
        minOffset,
        length(point(o, now, i).map((v, k) => v - (now.posKm[k] ?? 0)) as [number, number, number]),
      );
    expect(minOffset).toBeLessThan(1);
    expect(
      length(point(o, now, 0).map((v, k) => v - (point(o, now, n - 1)[k] ?? 0)) as [number, number, number]),
    ).toBeLessThan(1e3);
    // Every vertex is on the conic (r between q and Q), and consecutive vertices are close (no facets).
    const { periapsisRadiusKm: q, apoapsisRadiusKm: Q } = osculatingElements(now, MU);
    for (let i = 0; i < n; i++) {
      const r = length(point(o, now, i));
      expect(r).toBeGreaterThan(q * 0.999999);
      expect(r).toBeLessThan((Q ?? Infinity) * 1.000001);
      if (i > 0) {
        const step = length(
          point(o, now, i).map((v, k) => v - (point(o, now, i - 1)[k] ?? 0)) as [number, number, number],
        );
        expect(step / r).toBeLessThan(0.03);
      }
    }
  });

  it('draws an open orbit up to the cut-off radius, both sides of perihelion', () => {
    const peri = atPerihelion(1.2 * AU, 1.05);
    const now = propagateKepler(peri, -100 * DAY, MU);
    const o = conicOffsetsAround(now, MU, 1e-6, 30 * AU);
    const n = o.length / 3;
    expect(length(point(o, now, 0))).toBeCloseTo(30 * AU, -3);
    expect(length(point(o, now, n - 1))).toBeCloseTo(30 * AU, -3);
    let min = Infinity;
    for (let i = 0; i < n; i++) min = Math.min(min, length(point(o, now, i)));
    expect(min / AU).toBeCloseTo(1.2, 3);
  });

  it('finds the perihelion passages of bound and open orbits', () => {
    const peri = atPerihelion(1.0 * AU, 0.6);
    const t0 = 2461000.5;
    const later = propagateKepler(peri, 50 * DAY, MU);
    const bound = perihelionPassages(later, MU, t0 + 50);
    expect(bound.lastTdbJd).toBeCloseTo(t0, 4);
    const periodDays = (osculatingElements(peri, MU).periodS ?? 0) / DAY;
    expect((bound.nextTdbJd ?? 0) - t0).toBeCloseTo(periodDays, 3);

    const open = atPerihelion(1.0 * AU, 1.2);
    const before = propagateKepler(open, -30 * DAY, MU);
    const coming = perihelionPassages(before, MU, t0 - 30);
    expect(coming.nextTdbJd).toBeCloseTo(t0, 4);
    expect(coming.lastTdbJd).toBeUndefined();
  });

  it('estimates an asteroid magnitude with the H–G law', () => {
    // At opposition-like geometry (no phase), m = H + 5 log(r Δ).
    expect(asteroidMagnitude(3.2, 0.32, 2.36, 1.36, 0)).toBeCloseTo(3.2 + 5 * Math.log10(2.36 * 1.36), 10);
    // A phase angle dims it.
    expect(asteroidMagnitude(3.2, 0.32, 2.36, 1.36, 0.3)).toBeGreaterThan(
      asteroidMagnitude(3.2, 0.32, 2.36, 1.36, 0),
    );
  });

  it('estimates the magnitude with the usual comet law', () => {
    expect(cometMagnitude(5.5, 8, 1, 1)).toBeCloseTo(5.5, 10);
    expect(cometMagnitude(5.5, 8, 2, 1)).toBeCloseTo(5.5 + 20 * Math.log10(2), 10);
  });
});
