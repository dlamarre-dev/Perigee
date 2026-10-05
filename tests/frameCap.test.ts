import { describe, expect, it } from 'vitest';
import { DisplayInterval, shouldDrawFrame } from '../src/render/frameCap';

/** Frames drawn per second on a display of `hz` with a cap of `fps`. */
function drawnPerSecond(hz: number, fps: number | undefined): number {
  const display = new DisplayInterval();
  let last: number | undefined;
  let drawn = 0;
  for (let i = 0; i < hz * 10; i++) {
    const t = (i * 1000) / hz + (i % 3) * 0.3; // a little timer jitter
    display.record(t);
    if (last === undefined || shouldDrawFrame(t - last, fps, display.ms)) {
      last = t;
      drawn++;
    }
  }
  return drawn / 10;
}

describe('frame cap', () => {
  it('caps fast displays near the target without halving 60 and 75 Hz ones', () => {
    expect(drawnPerSecond(60, 60)).toBeCloseTo(60, 0);
    expect(drawnPerSecond(75, 60)).toBeCloseTo(75, 0);
    expect(drawnPerSecond(120, 60)).toBeCloseTo(60, 0);
    expect(drawnPerSecond(144, 60)).toBeCloseTo(72, 0);
    expect(drawnPerSecond(240, 60)).toBeCloseTo(60, 0);
    expect(drawnPerSecond(144, undefined)).toBeCloseTo(144, 0);
  });

  it('idles at about 30 fps', () => {
    expect(drawnPerSecond(60, 30)).toBeCloseTo(30, 0);
    expect(drawnPerSecond(120, 30)).toBeCloseTo(30, 0);
  });
});
