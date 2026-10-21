import { describe, expect, it } from 'vitest';
import { formatDec, formatRa, isBrightStar, isNearbyStar, starDirectionEqj } from '../src/astro/stars';
import { StarsCatalogSchema } from '../src/data/schemas';
import { blackbodyRgb, temperatureFromSpectralType } from '../src/render/starImage';
import starsJson from '../catalog/stars.json';

describe('stars', () => {
  it('points at the celestial poles and the equinox', () => {
    const [x, y, z] = starDirectionEqj({ raDeg: 0, decDeg: 90 });
    expect(Math.hypot(x, y)).toBeLessThan(1e-12);
    expect(z).toBeCloseTo(1, 12);
    expect(starDirectionEqj({ raDeg: 0, decDeg: 0 })).toEqual([1, 0, 0]);
    const q = starDirectionEqj({ raDeg: 90, decDeg: 0 });
    expect(q[0]).toBeCloseTo(0, 12);
    expect(q[1]).toBeCloseTo(1, 12);
  });

  it('formats Sirius as in SIMBAD (06 45 08.9, −16 42 58)', () => {
    expect(formatRa(101.28715533)).toBe('6h 45m 09s');
    expect(formatDec(-16.71611586)).toBe('−16° 42′ 58″');
    expect(formatRa(359.99999)).toBe('0h 00m 00s');
    expect(formatDec(89.26410897)).toBe('+89° 15′ 51″');
  });

  it('catalog is valid, ids unique, Polaris within a degree of the pole', () => {
    const catalog = StarsCatalogSchema.parse(starsJson);
    const ids = catalog.stars.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const polaris = catalog.stars.find((s) => s.id === 'polaris');
    expect(polaris && starDirectionEqj(polaris)[2]).toBeGreaterThan(Math.cos(DEG));
  });

  it('lists every star in the panel: bright (mag ≤ 2.5), within 20 light-years, or both', () => {
    const { stars } = StarsCatalogSchema.parse(starsJson);
    for (const s of stars) expect(isBrightStar(s) || isNearbyStar(s), s.id).toBe(true);
    // Every star of Wikipedia's List of brightest stars, to magnitude 2.5 (Alpha Centauri counted once).
    expect(stars.filter(isBrightStar).length).toBe(93);
    const nearby = stars.filter(isNearbyStar);
    // Every system within 20 ly whose primary is magnitude 12 or brighter (Wikipedia's List of nearest stars).
    expect(nearby.length).toBe(57);
    expect(nearby.every((s) => s.magnitude <= 12)).toBe(true);
    expect(stars.filter((s) => isBrightStar(s) && isNearbyStar(s)).map((s) => s.id)).toEqual([
      'sirius',
      'alpha-centauri',
      'procyon',
      'altair',
    ]);
  });
});

const DEG = Math.PI / 180;

describe('star illustration', () => {
  it('colours a black body: red dwarfs orange, the Sun near white, hot stars blue', () => {
    const [r1, g1, b1] = blackbodyRgb(3000);
    expect(r1).toBe(1);
    expect(b1).toBeLessThan(0.5);
    expect(g1).toBeLessThan(0.8);
    const sun = blackbodyRgb(5772);
    expect(Math.min(...sun)).toBeGreaterThan(0.85);
    const [r2, , b2] = blackbodyRgb(25_000);
    expect(b2).toBe(1);
    expect(r2).toBeLessThan(0.75);
  });

  it('falls back on the spectral class for the temperature', () => {
    expect(temperatureFromSpectralType('A0V')).toBe(9_000);
    expect(temperatureFromSpectralType('m1.5Iab')).toBe(3_400);
    expect(temperatureFromSpectralType('?')).toBeUndefined();
  });
});
