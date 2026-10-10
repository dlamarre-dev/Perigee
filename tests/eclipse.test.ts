import { describe, expect, it } from 'vitest';
import { AU_KM, EARTH_EQUATORIAL_RADIUS_KM } from '../src/astro/constants';
import { sunlitFraction } from '../src/astro/eclipse';
import type { Vec3 } from '../src/astro/vec3';

const R = EARTH_EQUATORIAL_RADIUS_KM;
const SUN: Vec3 = [1, 0, 0];

/** ISS-like point 420 km up, `angleDeg` from the subsolar direction around the Earth. */
function lit(angleDeg: number): number {
  const a = (angleDeg * Math.PI) / 180;
  const r = R + 420;
  const p: Vec3 = [r * Math.cos(a), r * Math.sin(a), 0];
  return sunlitFraction([-p[0], -p[1], -p[2]], R, SUN, AU_KM);
}

describe('sunlitFraction', () => {
  it('is 1 on the day side and 0 deep in the umbra', () => {
    expect(lit(0)).toBe(1);
    expect(lit(90)).toBe(1);
    expect(lit(180)).toBe(0);
  });

  it('goes from 1 to 0 across a penumbra a fraction of a degree wide, symmetrically', () => {
    // Shadow edge in low orbit: the Earth's limb seen from 420 km is ~70.3° below the horizontal.
    const edge = 90 + (Math.acos(R / (R + 420)) * 180) / Math.PI;
    expect(lit(edge - 0.6)).toBe(1);
    expect(lit(edge + 0.6)).toBe(0);
    expect(lit(edge)).toBeCloseTo(0.5, 1);
    const samples = [-0.2, -0.1, 0, 0.1, 0.2].map((d) => lit(edge + d));
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] ?? 1);
  });

  it('leaves an annulus when the body looks smaller than the Sun', () => {
    // Far behind a small body, centred on the Sun: only the body's disc is hidden.
    const f = sunlitFraction([1e6, 0, 0], 1000, SUN, AU_KM);
    const sunR = Math.asin(695_700 / AU_KM);
    const bodyR = Math.asin(1000 / 1e6);
    expect(f).toBeCloseTo(1 - (bodyR / sunR) ** 2, 6);
  });
});
