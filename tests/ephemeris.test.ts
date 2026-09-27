import { describe, expect, it } from 'vitest';
import { Astronomy } from '../src/astro/astronomy';
import { bodyOrientationEqj, MOON_RADIUS_KM, moonToEarthKm } from '../src/astro/bodies';
import { RAD_TO_DEG, SECONDS_PER_DAY } from '../src/astro/constants';
import { EPHEM_ROW, EphemerisTable } from '../src/astro/hermite';
import { ellipseOffsetsAround, GM_KM3_S2, osculatingElements, propagateKepler } from '../src/astro/kepler';
import { quatConjugate, quatNorm, quatRotate } from '../src/astro/quat';
import { length, sub, type Vec3 } from '../src/astro/vec3';

const MU = GM_KM3_S2.moon;
/** 100 km circular-ish polar lunar orbit, slightly eccentric, like LRO. */
const initial = (() => {
  const r = MOON_RADIUS_KM + 100;
  const v = Math.sqrt(MU / r) * 1.01;
  return { posKm: [r, 0, 0] as Vec3, velKmS: [0, v * 0.2, v * 0.98] as Vec3 };
})();

function syntheticTable(stepS: number, durationS: number, t0Jd = 2_461_310): EphemerisTable {
  const n = Math.floor(durationS / stepS) + 1;
  const data = new Float64Array(n * EPHEM_ROW);
  for (let i = 0; i < n; i++) {
    const s = propagateKepler(initial, i * stepS, MU);
    data.set([t0Jd + (i * stepS) / SECONDS_PER_DAY, ...s.posKm, ...s.velKmS], i * EPHEM_ROW);
  }
  return new EphemerisTable(data);
}

describe('Kepler propagation', () => {
  it('returns to the start after one period and conserves energy', () => {
    const el = osculatingElements(initial, MU);
    expect(el.periodS).toBeDefined();
    const back = propagateKepler(initial, el.periodS ?? 0, MU);
    expect(length(sub(back.posKm, initial.posKm))).toBeLessThan(1e-6);
    const energy = (s: typeof initial) => length(s.velKmS) ** 2 / 2 - MU / length(s.posKm);
    const later = propagateKepler(initial, 12_345, MU);
    expect(Math.abs(energy(later) - energy(initial))).toBeLessThan(1e-10);
  });

  it('computes elements of the synthetic orbit', () => {
    const el = osculatingElements(initial, MU);
    expect(el.inclinationRad * RAD_TO_DEG).toBeCloseTo(78.46, 1);
    expect(el.periapsisRadiusKm).toBeCloseTo(MOON_RADIUS_KM + 100, 3);
    expect((el.periodS ?? 0) / 60).toBeGreaterThan(115);
    expect((el.periodS ?? 0) / 60).toBeLessThan(125);
  });

  it('propagates backwards consistently', () => {
    const fwd = propagateKepler(initial, 5000, MU);
    const back = propagateKepler(fwd, -5000, MU);
    expect(length(sub(back.posKm, initial.posKm))).toBeLessThan(1e-6);
  });
});

describe('Hermite interpolation of ephemerides', () => {
  it('reconstructs a Keplerian low lunar orbit to < 10 m with a 2 min step', () => {
    const table = syntheticTable(120, 4 * 3600);
    let maxErrKm = 0;
    for (let tS = 0; tS <= 4 * 3600; tS += 7.3) {
      const t = table.startTdbJd + tS / SECONDS_PER_DAY;
      const got = table.interpolate(t);
      const truth = propagateKepler(initial, tS, MU);
      if (!got) throw new Error('outside table');
      maxErrKm = Math.max(maxErrKm, length(sub(got.posKm, truth.posKm)));
    }
    expect(maxErrKm).toBeLessThan(0.01);
  });

  it('interpolates velocity too', () => {
    const table = syntheticTable(120, 3600);
    const tS = 1000;
    const got = table.interpolate(table.startTdbJd + tS / SECONDS_PER_DAY);
    const truth = propagateKepler(initial, tS, MU);
    expect(length(sub(got?.velKmS ?? [0, 0, 0], truth.velKmS))).toBeLessThan(1e-4);
  });

  it('is exact at samples and undefined outside the table', () => {
    const table = syntheticTable(120, 3600);
    const s = table.state(5);
    expect(length(sub(table.interpolate(table.time(5))?.posKm ?? [0, 0, 0], s.posKm))).toBeLessThan(1e-9);
    expect(table.interpolate(table.endTdbJd + 1e-3)).toBeUndefined();
  });

  it('rejects malformed tables', () => {
    expect(() => new EphemerisTable(new Float64Array(8))).toThrow();
    const data = new Float64Array(14);
    data[0] = 2;
    data[7] = 1;
    expect(() => new EphemerisTable(data)).toThrow();
  });
});

describe('lunar rotation (IAU model)', () => {
  it('returns a unit quaternion', () => {
    expect(quatNorm(bodyOrientationEqj(Astronomy.Body.Moon, new Date()))).toBeCloseTo(1, 12);
  });

  it('puts the sub-Earth point at the optical libration given by astronomy-engine (< 1°)', () => {
    for (const iso of ['2026-01-15T00:00:00Z', '2026-09-26T12:00:00Z', '2030-06-01T00:00:00Z']) {
      const date = new Date(iso);
      const q = bodyOrientationEqj(Astronomy.Body.Moon, date);
      // Direction to the Earth in the Moon body-fixed frame.
      const e = quatRotate(quatConjugate(q), moonToEarthKm(date));
      const lonDeg = Math.atan2(e[1], e[0]) * RAD_TO_DEG;
      const latDeg = Math.asin(e[2] / length(e)) * RAD_TO_DEG;
      const lib = Astronomy.Libration(date);
      expect(Math.abs(lonDeg - lib.elon), `longitude at ${iso}`).toBeLessThan(1);
      expect(Math.abs(latDeg - lib.elat), `latitude at ${iso}`).toBeLessThan(1);
    }
  });
});

describe('Mars orientation (IAU model)', () => {
  it('matches the IAU WGCCRE pole and prime meridian at J2000 and the sidereal rate', () => {
    const j2000 = new Date(Date.UTC(2000, 0, 1, 11, 58, 55, 816)); // J2000.0 TT
    const axis = Astronomy.RotationAxis(Astronomy.Body.Mars, j2000);
    expect(axis.ra * 15).toBeCloseTo(317.681, 1);
    expect(axis.dec).toBeCloseTo(52.887, 1);
    // IAU 2015: W = 176.049863 + 350.891982443297 d (plus sub-degree periodic terms).
    expect(Math.abs(((axis.spin - 176.05 + 540) % 360) - 180)).toBeLessThan(1);
    const oneDay = Astronomy.RotationAxis(Astronomy.Body.Mars, new Date(j2000.getTime() + 86_400_000));
    const rate = (oneDay.spin - axis.spin + 360) % 360;
    expect(rate).toBeCloseTo(350.892, 1);
  });

  it('places the pole of the body frame on the IAU pole direction', () => {
    const q = bodyOrientationEqj(Astronomy.Body.Mars, new Date('2026-09-27T00:00:00Z'));
    const pole = quatRotate(q, [0, 0, 1]);
    const axis = Astronomy.RotationAxis(Astronomy.Body.Mars, new Date('2026-09-27T00:00:00Z'));
    expect(length(sub(pole, [axis.north.x, axis.north.y, axis.north.z]))).toBeLessThan(1e-9);
  });
});

describe('body-anchored osculating ellipse', () => {
  // Eris-like heliocentric orbit: a ≈ 67.7 AU, e ≈ 0.44, inclined.
  const mu = GM_KM3_S2.sun;
  const state = {
    posKm: [5.8e9, 1.9e9, 4.4e9] as Vec3,
    velKmS: [-0.9, 3.1, 0.6] as Vec3,
  };
  const off = ellipseOffsetsAround(state, mu, 1e-7);
  it('passes through the body and matches two-body propagation', () => {
    expect(off).toBeDefined();
    if (!off) return;
    const n = off.length / 3;
    // The point with a zero offset is the body itself.
    let zero = false;
    for (let i = 0; i < n; i++)
      if (off[i * 3] === 0 && off[i * 3 + 1] === 0 && off[i * 3 + 2] === 0) zero = true;
    expect(zero).toBe(true);
    // Every point lies on the orbit: compare with Kepler propagation at the matching time.
    const el = osculatingElements(state, mu);
    const period = el.periodS ?? 0;
    const points: Vec3[] = [];
    for (let i = 0; i < n; i++) points.push([off[i * 3] ?? 0, off[i * 3 + 1] ?? 0, off[i * 3 + 2] ?? 0]);
    for (let k = 1; k < 64; k++) {
      const p = propagateKepler(state, (k / 64) * period, mu).posKm;
      const rel = sub(p, state.posKm);
      const nearest = Math.min(...points.map((q) => length(sub(q, rel))));
      // Far-side spacing is coarse: the propagated point is within one segment of the polyline vertices.
      expect(nearest / length(rel)).toBeLessThan(0.1);
    }
  });
  it('is dense and precise next to the body', () => {
    if (!off) return;
    const n = off.length / 3;
    const mid = (n - 1) / 2;
    const p1: Vec3 = [off[(mid + 1) * 3] ?? 0, off[(mid + 1) * 3 + 1] ?? 0, off[(mid + 1) * 3 + 2] ?? 0];
    // First step: 1e-7 rad of eccentric anomaly, a few hundred km along a 67 AU orbit.
    expect(length(p1)).toBeGreaterThan(100);
    expect(length(p1)).toBeLessThan(2000);
    const exact = propagateKepler(state, length(p1) / length(state.velKmS), mu).posKm;
    expect(length(sub(sub(exact, state.posKm), p1))).toBeLessThan(1);
  });
});
