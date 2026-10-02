import { describe, expect, it } from 'vitest';
import { alignAxes, axisVector } from '../src/astro/attitude';
import { quatRotate } from '../src/astro/quat';
import { dot, normalize, type Vec3 } from '../src/astro/vec3';

describe('model attitude', () => {
  it('points the primary axis at the target and the secondary towards the second direction', () => {
    const toEarth: Vec3 = normalize([0.3, -0.8, 0.5]);
    const toSun: Vec3 = normalize([1, 0.2, 0]);
    const q = alignAxes(axisVector('+z'), toEarth, axisVector('+y'), toSun);
    const z = quatRotate(q, [0, 0, 1]);
    const y = quatRotate(q, [0, 1, 0]);
    expect(dot(z, toEarth)).toBeCloseTo(1, 12);
    // The secondary axis is perpendicular to the primary and leans towards the Sun.
    expect(dot(y, toEarth)).toBeCloseTo(0, 12);
    expect(dot(y, toSun)).toBeGreaterThan(0.5);
  });

  it('handles negative axes and a secondary direction parallel to the primary', () => {
    const down: Vec3 = [0, 0, -1];
    const q = alignAxes(axisVector('-y'), down, axisVector('+z'), [0, 0, 1]);
    expect(dot(quatRotate(q, [0, -1, 0]), down)).toBeCloseTo(1, 12);
  });
});
