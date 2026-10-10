import { describe, expect, it } from 'vitest';
import { haumeaOrientationEqj } from '../src/astro/bodies';
import { DEG_TO_RAD } from '../src/astro/constants';
import { quatRotate } from '../src/astro/quat';

describe('Haumea orientation', () => {
  const t0 = 2_461_324.5;
  it('spins about the ring pole (α 285.1°, δ −10.6°)', () => {
    const pole = quatRotate(haumeaOrientationEqj(t0), [0, 0, 1]);
    const ra = 285.1 * DEG_TO_RAD;
    const dec = -10.6 * DEG_TO_RAD;
    const want = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
    pole.forEach((v, i) => expect(v).toBeCloseTo(want[i] ?? NaN, 9));
  });

  it('turns once every 3.915341 h and half a turn in half that', () => {
    const x0 = quatRotate(haumeaOrientationEqj(t0), [1, 0, 0]);
    const x1 = quatRotate(haumeaOrientationEqj(t0 + 3.915341 / 24), [1, 0, 0]);
    const xh = quatRotate(haumeaOrientationEqj(t0 + 3.915341 / 48), [1, 0, 0]);
    x1.forEach((v, i) => expect(v).toBeCloseTo(x0[i] ?? NaN, 6));
    xh.forEach((v, i) => expect(v).toBeCloseTo(-(x0[i] ?? NaN), 6));
  });
});
