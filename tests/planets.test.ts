import { describe, expect, it } from 'vitest';
import { AU_KM } from '../src/astro/constants';
import {
  PLANETS,
  heliocentricKm,
  logScalePosition,
  logScaleRadiusKm,
  orbitPolyline,
} from '../src/astro/planets';
import { length, sub } from '../src/astro/vec3';

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

  it('closes the orbit polyline after one sidereal period', () => {
    const mars = PLANETS.find((p) => p.id === 'mars');
    if (!mars) throw new Error('missing Mars');
    const pts = orbitPolyline(mars, new Date('2026-01-01T00:00:00Z'), 180);
    const first = [pts[0] ?? 0, pts[1] ?? 0, pts[2] ?? 0] as const;
    const n = pts.length;
    const last = [pts[n - 3] ?? 0, pts[n - 2] ?? 0, pts[n - 1] ?? 0] as const;
    // Perturbations keep it from closing exactly; within 1 % of the orbit radius.
    expect(length(sub(first, last)) / AU_KM).toBeLessThan(0.015);
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
