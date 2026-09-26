import { describe, expect, it } from 'vitest';
import { RAD_TO_DEG } from '../src/astro/constants';
import { eciToEcef, latLonToUnit, rotZ } from '../src/astro/frames';
import { sunDirectionEci } from '../src/astro/sun';
import { gmstRad } from '../src/astro/time';
import { length } from '../src/astro/vec3';

function declinationDeg(date: Date): number {
  const s = sunDirectionEci(date);
  return Math.asin(s[2]) * RAD_TO_DEG;
}

// The direction is in the J2000 frame: at an equinox, precession since 2000 shifts declination by
// ≈ 20″/yr × 26 yr ≈ 0.15°, hence the tolerances below.
describe('Sun direction (J2000 equatorial)', () => {
  it('is a unit vector', () => {
    expect(length(sunDirectionEci(new Date()))).toBeCloseTo(1, 12);
  });

  it('has declination ≈ 0 at the March 2026 equinox', () => {
    expect(Math.abs(declinationDeg(new Date('2026-03-20T14:46:00Z')))).toBeLessThan(0.3);
  });

  it('has declination ≈ +23.44° at the June 2026 solstice', () => {
    expect(declinationDeg(new Date('2026-06-21T08:24:00Z'))).toBeCloseTo(23.44, 1);
  });

  it('has declination ≈ −23.44° at the December 2026 solstice', () => {
    expect(declinationDeg(new Date('2026-12-21T20:50:00Z'))).toBeCloseTo(-23.44, 1);
  });

  it('is overhead near longitude 0 around 12:00 UTC at the equinox (Earth-fixed frame)', () => {
    const date = new Date('2026-03-20T12:07:00Z'); // equation of time ≈ −7 min
    const sunEcef = eciToEcef(sunDirectionEci(date), gmstRad(date));
    const subSolarLonDeg = Math.atan2(sunEcef[1], sunEcef[0]) * RAD_TO_DEG;
    expect(Math.abs(subSolarLonDeg)).toBeLessThan(1);
  });
});

describe('frames', () => {
  it('rotZ by π/2 maps +X to +Y', () => {
    const v = rotZ([1, 0, 0], Math.PI / 2);
    expect(v[0]).toBeCloseTo(0, 15);
    expect(v[1]).toBeCloseTo(1, 15);
  });

  it('latLonToUnit places lon 90°E on +Y and the north pole on +Z', () => {
    expect(latLonToUnit(0, Math.PI / 2)[1]).toBeCloseTo(1, 15);
    expect(latLonToUnit(Math.PI / 2, 0)[2]).toBeCloseTo(1, 15);
  });
});
