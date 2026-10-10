import { describe, expect, it } from 'vitest';
import { RAD_TO_DEG } from '../src/astro/constants';
import {
  CARRINGTON_RATE_DEG_PER_DAY,
  carringtonRotation,
  subEarthCarringtonDeg,
  regionObservedAt,
  spotRadiusRad,
  sunspotGroups,
  sunspotRateDegPerDay,
} from '../src/astro/sunspots';
import type { SunRegions } from '../src/data/schemas';
import { parseSwpcRegions } from '../pipeline/sun';

const record = (over: Partial<SunRegions[number]>): SunRegions[number] => ({
  region: 4530,
  date: '2026-09-11',
  latDeg: 19,
  carringtonLonDeg: 220,
  areaMh: 30,
  spots: 7,
  ...over,
});

describe('sunspot placement', () => {
  it('uses the Carrington frame: NOAA region 4530 (N19W35, L = 220°) sits 35° west of the central meridian', () => {
    // SWPC SRS of 2026-09-11: positions as of 24:00 UT.
    const l0 = subEarthCarringtonDeg(regionObservedAt('2026-09-11'));
    expect(Math.abs(220 - l0 - 35)).toBeLessThan(2);
  });

  it('starts a Carrington rotation when the central meridian crosses longitude 0', () => {
    // Find the first change of rotation number after a date, hour by hour.
    let t = Date.parse('2026-09-01T00:00:00Z');
    const n = carringtonRotation(new Date(t));
    while (carringtonRotation(new Date(t)) === n) t += 3_600_000;
    const l0 = subEarthCarringtonDeg(new Date(t));
    expect(Math.min(l0, 360 - l0)).toBeLessThan(1.5);
  });

  it('turns faster than the Carrington frame at the equator, slower at high latitude', () => {
    expect(sunspotRateDegPerDay(0)).toBeGreaterThan(CARRINGTON_RATE_DEG_PER_DAY);
    expect(sunspotRateDegPerDay(Math.PI / 4)).toBeLessThan(CARRINGTON_RATE_DEG_PER_DAY);
  });

  it('sizes a group from its area (1000 MH ≈ 2.6°)', () => {
    expect(spotRadiusRad(1000) * RAD_TO_DEG).toBeCloseTo(2.56, 2);
  });

  it('keeps the latest report before the date, moved by differential rotation', () => {
    const regions = [
      record({ date: '2026-09-10', carringtonLonDeg: 221 }),
      record({}),
      record({ date: '2026-09-14' }),
    ];
    const [g] = sunspotGroups(regions, new Date('2026-09-14T00:00:00Z'));
    expect(g?.observedAt.toISOString()).toBe('2026-09-12T00:00:00.000Z');
    const drift = sunspotRateDegPerDay(19 / RAD_TO_DEG) - CARRINGTON_RATE_DEG_PER_DAY;
    expect((g?.lonRad ?? 0) * RAD_TO_DEG).toBeCloseTo(220 + 2 * drift, 6);
    expect(g?.strength).toBe(1);
  });

  it('fades a group out two weeks after its last report, and shows none before the first one', () => {
    const regions = [record({})];
    const at = (days: number) =>
      sunspotGroups(regions, new Date(Date.parse('2026-09-12T00:00:00Z') + days * 86_400_000));
    expect(at(10)[0]?.strength).toBeGreaterThan(0);
    expect(at(10)[0]?.strength).toBeLessThan(1);
    expect(at(14)).toEqual([]);
    expect(at(-3)).toEqual([]);
  });

  it('gives plage regions (no spots) a zero radius', () => {
    const [g] = sunspotGroups([record({ areaMh: null, spots: null })], new Date('2026-09-12T06:00:00Z'));
    expect(g?.radiusRad).toBe(0);
  });
});

describe('SWPC regions feed', () => {
  it('keeps the fields used, sorted by date and region', () => {
    const parsed = parseSwpcRegions([
      {
        observed_date: '2026-09-11',
        region: 4530,
        latitude: 19,
        longitude: -35,
        location: 'N19W35',
        carrington_longitude: 220,
        area: 30,
        number_spots: 7,
      },
      {
        observed_date: '2026-09-10',
        region: 4526,
        latitude: -2,
        carrington_longitude: 216,
        area: null,
        number_spots: null,
      },
    ]);
    expect(parsed).toEqual([
      { region: 4526, date: '2026-09-10', latDeg: -2, carringtonLonDeg: 216, areaMh: null, spots: null },
      { region: 4530, date: '2026-09-11', latDeg: 19, carringtonLonDeg: 220, areaMh: 30, spots: 7 },
    ]);
  });

  it('rejects an unexpected feed', () => {
    expect(() => parseSwpcRegions([])).toThrow();
    expect(() => parseSwpcRegions({ regions: [] })).toThrow();
  });
});
