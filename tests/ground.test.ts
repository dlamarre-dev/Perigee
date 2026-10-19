import { readFileSync } from 'node:fs';
import * as Astronomy from 'astronomy-engine';
import * as sat from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { DEG_TO_RAD, RAD_TO_DEG } from '../src/astro/constants';
import { OmmListSchema } from '../src/data/schemas';
import { makeSatrec } from '../src/earth/sgp4';
import { compassPoint, ecefFromGeodetic, geodeticFromEcef, regionAt } from '../src/engine/ground';
import { meanOrbit } from '../src/engine/orbitTools';
import { findPasses, sunTeme } from '../src/engine/passes';

const omm = OmmListSchema.parse(JSON.parse(readFileSync('tests/fixtures/omm-sample.json', 'utf8')));
const iss = omm.find((o) => o.NORAD_CAT_ID === 25544);
if (!iss) throw new Error('fixture');

describe('ground points', () => {
  it('converts geodetic coordinates both ways on WGS 84', () => {
    for (const [lat, lon, h] of [
      [45.5, -73.57, 0.05],
      [-89.9, 10, 3],
      [0, 179.9, 420],
    ] as const) {
      const g = geodeticFromEcef(ecefFromGeodetic(lat * DEG_TO_RAD, lon * DEG_TO_RAD, h));
      expect(g.latRad * RAD_TO_DEG).toBeCloseTo(lat, 7);
      expect(g.lonRad * RAD_TO_DEG).toBeCloseTo(lon, 7);
      expect(g.heightKm).toBeCloseTo(h, 5);
    }
  });

  it('names the country or sea below', () => {
    const at = (lat: number, lon: number) => regionAt(lat * DEG_TO_RAD, lon * DEG_TO_RAD);
    expect(at(48.86, 2.35)).toMatchObject({ kind: 'country', iso: 'FR', name: { fr: 'France' } });
    expect(at(45.5, -73.57)).toMatchObject({ kind: 'country', iso: 'CA' });
    expect(at(-25, -70 + 360)?.iso).toBe('CL');
    expect(at(-15, -140)).toMatchObject({ kind: 'sea', name: { en: 'Pacific Ocean' } });
    expect(at(-20, 75)).toMatchObject({ kind: 'sea', name: { fr: 'océan Indien' } });
  });

  it('names compass points', () => {
    expect([0, 44, 90, 200, 359].map((d) => compassPoint(d * DEG_TO_RAD))).toEqual([
      'N',
      'NE',
      'E',
      'SSW',
      'N',
    ]);
  });
});

describe('low-precision Sun', () => {
  it('agrees with astronomy-engine within 0.02°', () => {
    for (let year = 2026; year <= 2040; year += 2) {
      const date = new Date(Date.UTC(year, (year * 7) % 12, 10, 6));
      const time = Astronomy.MakeTime(date);
      const ref = Astronomy.RotateVector(
        Astronomy.Rotation_EQJ_EQD(time),
        Astronomy.GeoVector(Astronomy.Body.Sun, time, true),
      );
      const [x, y, z] = sunTeme(date);
      const cos =
        (x * ref.x + y * ref.y + z * ref.z) / (Math.hypot(x, y, z) * Math.hypot(ref.x, ref.y, ref.z));
      expect(Math.acos(Math.min(1, cos)) * RAD_TO_DEG).toBeLessThan(0.02);
    }
  });
});

describe('orbits', () => {
  it('describes the ISS from its mean elements', () => {
    const o = meanOrbit(iss);
    expect(o.regime).toBe('LEO');
    expect(o.inclinationDeg).toBeCloseTo(51.6, 1);
    expect(o.periodMin).toBeGreaterThan(90);
    expect(o.periodMin).toBeLessThan(94);
    expect(o.periapsisAltitudeKm).toBeGreaterThan(380);
    expect(o.apoapsisAltitudeKm).toBeLessThan(450);
  });
});

describe('satellite passes', () => {
  const satrec = makeSatrec(iss);
  if (!satrec) throw new Error('satrec');
  const observer = { latRad: 45.5017 * DEG_TO_RAD, lonRad: -73.5673 * DEG_TO_RAD, heightKm: 0 };
  const startMs = Date.parse('2026-09-26T00:00:00Z');
  const endMs = startMs + 3 * 86_400_000;
  const minElevationRad = 10 * DEG_TO_RAD;
  const result = findPasses({ satrec, observer, startMs, endMs, minElevationRad, limit: 60 });
  const look = (ms: number): sat.LookAngles => {
    const d = new Date(ms);
    const pv = sat.propagate(satrec, d) as { position: sat.EciVec3<number> };
    return sat.ecfToLookAngles(
      { latitude: observer.latRad, longitude: observer.lonRad, height: 0 },
      sat.eciToEcf(pv.position, sat.gstime(d)),
    );
  };

  it('finds the ISS passes over Montreal as satellite.js sees them', () => {
    // The ISS (51.6°) passes over 45.5° N several times a day; above 10°, a few of them.
    expect(result.passes.length).toBeGreaterThanOrEqual(6);
    expect(result.passes.length).toBeLessThanOrEqual(20);
    for (const p of result.passes) {
      expect(look(p.culmination.timeMs).elevation * RAD_TO_DEG).toBeCloseTo(
        p.culmination.elevationRad * RAD_TO_DEG,
        1,
      );
      expect(Math.abs(look(p.rise.timeMs).elevation * RAD_TO_DEG)).toBeLessThan(0.15);
      expect(Math.abs(look(p.set.timeMs).elevation * RAD_TO_DEG)).toBeLessThan(0.15);
      expect(p.culmination.elevationRad).toBeGreaterThanOrEqual(minElevationRad - 0.02);
      const minutes = (p.set.timeMs - p.rise.timeMs) / 60_000;
      expect(minutes).toBeGreaterThan(3);
      expect(minutes).toBeLessThan(12);
    }
    expect(result.alwaysAbove).toBe(false);
  });

  it('misses no pass: a dense scan finds the same ones', () => {
    let count = 0;
    let best = -Infinity;
    for (let ms = startMs; ms <= endMs; ms += 10_000) {
      const el = look(ms).elevation;
      if (el >= 0) best = Math.max(best, el);
      else if (best > -Infinity) {
        if (best >= minElevationRad) count++;
        best = -Infinity;
      }
    }
    expect(result.passes.length).toBe(count);
  });

  it('calls a pass visible only when the satellite is lit and the sky dark', () => {
    for (const p of result.passes) {
      if (p.visible) {
        expect(p.sunlitShare).toBeGreaterThan(0);
        expect(p.visible.maxElevationRad).toBeGreaterThanOrEqual(minElevationRad);
      }
      if (p.sunElevationRad > 0) expect(p.visible).toBeUndefined();
    }
  });
});
