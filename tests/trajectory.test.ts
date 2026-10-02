import { describe, expect, it } from 'vitest';
import { nearSampleTimes } from '../src/astro/trajectory';

describe('nearSampleTimes', () => {
  it('includes the current time and both ends, ascending, denser near now', () => {
    const t = nearSampleTimes(10, 11, 10.3, 24);
    const at = (i: number): number => t[i] ?? Number.NaN;
    expect(t).toHaveLength(49);
    expect(at(0)).toBeCloseTo(10, 12);
    expect(at(24)).toBe(10.3);
    expect(at(48)).toBeCloseTo(11, 12);
    for (let i = 1; i < t.length; i++) expect(at(i)).toBeGreaterThan(at(i - 1));
    // Steps grow away from now on both sides.
    expect(at(25) - at(24)).toBeLessThan(at(26) - at(25));
    expect(at(24) - at(23)).toBeLessThan(at(23) - at(22));
    // The first step is tiny compared with the interval.
    expect(at(25) - at(24)).toBeLessThan(1e-3);
  });

  it('handles a current time on an interval end', () => {
    const t = nearSampleTimes(0, 1, 0, 8);
    expect(t[0]).toBe(0);
    expect(t).toHaveLength(9);
    expect(t[8]).toBeCloseTo(1, 12);
  });
});
