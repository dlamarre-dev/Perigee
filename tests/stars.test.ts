import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
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

describe('star map', () => {
  it('places a star at its distance and opens with the Sun centred, the star to the right', async () => {
    const { footOnPlane, GALACTIC_NORTH_EQJ, homeState, starPositionLy } = await import('../src/ui/StarMap');
    const sirius = StarsCatalogSchema.parse(starsJson).stars.find((s) => s.id === 'sirius');
    if (!sirius) throw new Error('no Sirius');
    const p = starPositionLy(sirius);
    expect(Math.hypot(...p)).toBeCloseTo(8.6, 6);
    const home = homeState(p, 1.6);
    expect(home.targetKm).toEqual([0, 0, 0]);
    const { x, y, z, w } = home.orientation;
    const toCamera = new Quaternion(-x, -y, -z, w);
    // Stalks are vertical on screen: galactic north has no left-right component, and points up.
    const north = new Vector3(...GALACTIC_NORTH_EQJ).applyQuaternion(toCamera);
    expect(Math.abs(north.x)).toBeLessThan(1e-9);
    expect(north.y).toBeGreaterThan(0.8);
    // The star's foot lies to the right of the Sun, within the opening frame.
    const foot = footOnPlane(p);
    const local = new Vector3(...foot).applyQuaternion(toCamera);
    expect(local.x).toBeGreaterThan(0);
    const tanHalfX = Math.tan((22.5 * Math.PI) / 180) * 1.6;
    expect(local.x / (home.distanceKm * tanHalfX)).toBeLessThanOrEqual(0.7 + 1e-9);
    // A stalk's foot lies in the plane, straight below (or above) the star.
    const n = GALACTIC_NORTH_EQJ;
    expect(foot[0] * n[0] + foot[1] * n[1] + foot[2] * n[2]).toBeCloseTo(0, 9);
    const [sx, sy] = [p[0] - foot[0], p[1] - foot[1]];
    expect(Math.abs(sx * n[1] - sy * n[0])).toBeLessThan(1e-9);
  });

  it('looks along a galactic axis with north (or the galactic centre for Z) up', async () => {
    const { axisOrientation, GALACTIC_NORTH_EQJ: n } = await import('../src/ui/StarMap');
    const centre: [number, number, number] = [1, 0, 0];
    const north: [number, number, number] = [0, 0, 1];
    for (const [back, up] of [
      [[0, 1, 0], north],
      [[0, 0, 1], centre],
      [[0, 0, -1], centre],
    ] as const) {
      const { x, y, z, w } = axisOrientation(back, north, centre);
      const q = new Quaternion(x, y, z, w);
      const camBack = new Vector3(0, 0, 1).applyQuaternion(q);
      const camUp = new Vector3(0, 1, 0).applyQuaternion(q);
      expect(camBack.distanceTo(new Vector3(...back))).toBeLessThan(1e-9);
      expect(camUp.dot(new Vector3(...up))).toBeGreaterThan(0.999);
    }
    expect(Math.hypot(...n)).toBeCloseTo(1, 12);
  });
});
