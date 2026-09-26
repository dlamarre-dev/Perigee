import { describe, expect, it } from 'vitest';
import { DEG_TO_RAD, J2000_JD } from '../src/astro/constants';
import { SimClock, gmstRad, jdToUtc, utcToJd, utcToTdbJd } from '../src/astro/time';

describe('Julian dates', () => {
  it('J2000.0 epoch (2000-01-01T12:00:00Z) is JD 2451545.0', () => {
    expect(utcToJd(new Date('2000-01-01T12:00:00Z'))).toBe(J2000_JD);
  });

  it('round-trips through jdToUtc', () => {
    const d = new Date('2026-09-26T18:22:27.123Z');
    expect(jdToUtc(utcToJd(d)).getTime()).toBeCloseTo(d.getTime(), 0);
  });

  it('TDB − UTC is 37 + 32.184 s (± 2 ms) in 2026', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const offsetS = (utcToTdbJd(d) - utcToJd(d)) * 86_400;
    // JD doubles near 2.46e6 resolve ~40 µs, so compare at the ms level.
    expect(Math.abs(offsetS - 69.184)).toBeLessThan(0.002);
  });

  it('TDB − UTC is 32 + 32.184 s in 2000 and falls back to a model before 1972', () => {
    const d2000 = new Date('2000-06-01T00:00:00Z');
    expect(Math.abs((utcToTdbJd(d2000) - utcToJd(d2000)) * 86_400 - 64.184)).toBeLessThan(0.002);
    const d1960 = new Date('1960-01-01T00:00:00Z');
    const offset1960S = (utcToTdbJd(d1960) - utcToJd(d1960)) * 86_400;
    expect(offset1960S).toBeGreaterThan(30);
    expect(offset1960S).toBeLessThan(35);
  });
});

describe('GMST (IAU 1982)', () => {
  it('matches Vallado example 3-5: 1992-08-20 12:14 UT1 → 152.578787810°', () => {
    const angleRad = gmstRad(new Date('1992-08-20T12:14:00Z'));
    expect(Math.abs(angleRad - 152.57878781 * DEG_TO_RAD)).toBeLessThan(1e-6);
  });

  it('stays in [0, 2π) before J2000', () => {
    const angleRad = gmstRad(new Date('1970-01-01T00:00:00Z'));
    expect(angleRad).toBeGreaterThanOrEqual(0);
    expect(angleRad).toBeLessThan(2 * Math.PI);
  });
});

describe('SimClock', () => {
  function makeClock(startWallMs: number) {
    let monoMs = 0;
    const clock = new SimClock(
      () => monoMs,
      () => startWallMs + monoMs,
    );
    return { clock, advance: (ms: number) => (monoMs += ms) };
  }

  it('follows real time at ×1', () => {
    const { clock, advance } = makeClock(1_000_000);
    advance(500);
    expect(clock.nowMs()).toBe(1_000_500);
    expect(clock.isLive()).toBe(true);
  });

  it('accelerates without discontinuity when the rate changes', () => {
    const { clock, advance } = makeClock(0);
    advance(1000);
    clock.setRate(10_000);
    expect(clock.nowMs()).toBe(1000);
    advance(1000);
    expect(clock.nowMs()).toBe(1000 + 10_000_000);
    expect(clock.isLive()).toBe(false);
  });

  it('pauses and jumps', () => {
    const { clock, advance } = makeClock(0);
    clock.setRate(0);
    advance(5000);
    expect(clock.nowMs()).toBe(0);
    expect(clock.paused).toBe(true);
    clock.jumpTo(new Date('2030-01-01T00:00:00Z'));
    advance(5000);
    expect(clock.nowUtc().toISOString()).toBe('2030-01-01T00:00:00.000Z');
  });

  it('goLive returns to the wall clock at ×1', () => {
    const { clock, advance } = makeClock(0);
    clock.setRate(100);
    advance(1000);
    clock.goLive();
    expect(clock.rate).toBe(1);
    expect(clock.isLive()).toBe(true);
  });
});
