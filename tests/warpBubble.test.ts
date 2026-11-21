import { describe, expect, it } from 'vitest';
import { warpTargets } from '../src/render/WarpBubble';

const C = 299_792.458;

describe('warp bubble', () => {
  it('stays off below the speed of light', () => {
    expect(warpTargets(0)).toEqual({ dark: 0, streak: 0 });
    expect(warpTargets(0.99 * C)).toEqual({ dark: 0, streak: 0 });
  });

  it('darkens the rear quickly and stretches the streaks with the speed', () => {
    expect(warpTargets(3.2 * C).dark).toBe(0.5);
    const slow = warpTargets(10 * C).streak;
    const fast = warpTargets(100 * C).streak;
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    expect(warpTargets(1000 * C).streak).toBeGreaterThan(fast);
    expect(warpTargets(100_000 * C).streak).toBe(1);
  });
});
