import { describe, expect, it } from 'vitest';
import { AU_KM } from '../src/astro/constants';
import {
  PLANETS,
  heliocentricKm,
  logScalePosition,
  logScaleRadiusKm,
  heliocentricState,
  hillRadiusKm,
} from '../src/astro/planets';
import { ellipseOffsetsAround, GM_KM3_S2 } from '../src/astro/kepler';
import { ceresOrientationEqj } from '../src/astro/bodies';
import { quatRotate } from '../src/astro/quat';
import { add, dot, length, scale, sub, type Vec3 } from '../src/astro/vec3';

describe('planets', () => {
  it('places the Earth at ~1 AU and Jupiter at ~5.2 AU', () => {
    const d = new Date('2026-09-27T00:00:00Z');
    const earth = PLANETS.find((p) => p.id === 'earth');
    const jupiter = PLANETS.find((p) => p.id === 'jupiter');
    if (!earth || !jupiter) throw new Error('missing planet');
    const re = length(heliocentricKm(earth.body, d)) / AU_KM;
    expect(re).toBeGreaterThan(0.983);
    expect(re).toBeLessThan(1.017);
    const rj = length(heliocentricKm(jupiter.body, d)) / AU_KM;
    expect(rj).toBeGreaterThan(4.95);
    expect(rj).toBeLessThan(5.46);
  });

  it('osculating orbits stay on the true planet orbits', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    for (const id of ['mercury', 'earth', 'mars', 'jupiter', 'neptune']) {
      const planet = PLANETS.find((p) => p.id === id);
      if (!planet) throw new Error(`missing ${id}`);
      const state = heliocentricState(planet.body, date);
      const offsets = ellipseOffsetsAround(state, GM_KM3_S2.sun + planet.gmKm3S2, 1e-6);
      if (!offsets) throw new Error('unbound');
      // True positions over one period lie within 0.5 % of the orbit radius from the drawn ellipse.
      const periodMs = planet.periodDays * 86_400_000;
      for (let k = 1; k < 12; k++) {
        const truth = heliocentricKm(planet.body, new Date(date.getTime() + (k / 12) * periodMs));
        const vertex = (i: number): Vec3 => [
          state.posKm[0] + (offsets[i * 3] ?? 0),
          state.posKm[1] + (offsets[i * 3 + 1] ?? 0),
          state.posKm[2] + (offsets[i * 3 + 2] ?? 0),
        ];
        let best = Infinity;
        for (let i = 0; i + 1 < offsets.length / 3; i++) {
          // Distance from the true position to the drawn segment.
          const p0 = vertex(i);
          const d = sub(vertex(i + 1), p0);
          const u = Math.max(0, Math.min(1, dot(sub(truth, p0), d) / Math.max(dot(d, d), 1e-9)));
          best = Math.min(best, length(sub(truth, add(p0, scale(d, u)))));
        }
        expect(best / length(truth)).toBeLessThan(0.005);
      }
    }
  });

  it('Earth Hill radius is about 1.5 million km', () => {
    const earth = PLANETS.find((p) => p.id === 'earth');
    if (!earth) throw new Error('missing Earth');
    expect(hillRadiusKm(earth, AU_KM) / 1e6).toBeCloseTo(1.5, 1);
  });

  it('log scale maps 1 AU to 1 AU, is monotonic, and preserves direction', () => {
    expect(logScaleRadiusKm(AU_KM) / AU_KM).toBeCloseTo(1, 12);
    expect(logScaleRadiusKm(0)).toBe(0);
    let prev = 0;
    for (const au of [0.4, 1, 5, 30, 170]) {
      const r = logScaleRadiusKm(au * AU_KM);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
    expect(logScaleRadiusKm(170 * AU_KM) / AU_KM).toBeLessThan(5);
    const p = logScalePosition([3 * AU_KM, 4 * AU_KM, 0]);
    expect(p[0] / p[1]).toBeCloseTo(0.75, 12);
  });
});

describe('Ceres orientation (IAU 2015)', () => {
  const DEG = Math.PI / 180;
  it('puts the pole at α₀ = 291.418°, δ₀ = 66.764° and W at 170.65° + 952.1532°·d', () => {
    const q = ceresOrientationEqj(2_451_545.0);
    const pole = quatRotate(q, [0, 0, 1]);
    const [a, d] = [291.418 * DEG, 66.764 * DEG];
    expect(pole[0]).toBeCloseTo(Math.cos(d) * Math.cos(a), 12);
    expect(pole[1]).toBeCloseTo(Math.cos(d) * Math.sin(a), 12);
    expect(pole[2]).toBeCloseTo(Math.sin(d), 12);
    // Prime meridian: W measured from the ascending node of the equator on the ICRF equator (Q = ẑ × pole).
    const node = [Math.cos(a + Math.PI / 2), Math.sin(a + Math.PI / 2), 0];
    const pm = quatRotate(q, [1, 0, 0]);
    const cosW = pm[0] * (node[0] ?? 0) + pm[1] * (node[1] ?? 0);
    expect(Math.acos(cosW) / DEG).toBeCloseTo(170.65, 6);
    // One day later W advanced by 952.1532° (mod 360).
    const pm1 = quatRotate(ceresOrientationEqj(2_451_546.0), [1, 0, 0]);
    const cosW1 = pm1[0] * (node[0] ?? 0) + pm1[1] * (node[1] ?? 0);
    expect(Math.acos(cosW1) / DEG).toBeCloseTo(Math.abs(((170.65 + 952.1532 + 180) % 360) - 180), 6);
  });
});
