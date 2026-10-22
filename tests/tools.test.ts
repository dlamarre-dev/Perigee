import { readFileSync } from 'node:fs';
import * as Astronomy from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { OmmListSchema } from '../src/data/schemas';
import { makeSatrec } from '../src/earth/sgp4';
import { closestApproaches } from '../src/engine/closeApproach';
import { skyConjunctions } from '../src/engine/conjunctions';
import { groundTrackPoints, trackGeoJson } from '../src/engine/groundTrack';
import { compassLabel, NOTES } from '../src/engine/notes';
import { earthShadowFraction, lightChanges, lightOf } from '../src/engine/shadow';

const omm = OmmListSchema.parse(JSON.parse(readFileSync('tests/fixtures/omm-sample.json', 'utf8')));
const iss = omm.find((o) => o.NORAD_CAT_ID === 25544);
const satrec = iss && makeSatrec(iss);
const T0 = Date.parse('2026-09-26T10:00:00Z');

describe('shadow', () => {
  it('a point behind the Earth is in the umbra, one towards the Sun in sunlight', () => {
    const sun: [number, number, number] = [1.496e8, 0, 0];
    expect(earthShadowFraction([-7000, 0, 0], sun, 6378.137)).toBe(0);
    expect(earthShadowFraction([7000, 0, 0], sun, 6378.137)).toBe(1);
    expect(lightOf(0.5)).toBe('penumbra');
  });

  it('times each change of light to the second', async () => {
    // Sunlit, penumbra from t = 100.0 s to 108.0 s, then umbra.
    const f = (ms: number) => (ms < 100_000 ? 1 : ms < 108_000 ? 0.5 : 0);
    const changes = await lightChanges(f, 0, 300_000, 30_000);
    expect(changes.map((c) => c.to)).toEqual(['penumbra', 'umbra']);
    expect(Math.abs((changes[0]?.timeMs ?? 0) - 100_000)).toBeLessThanOrEqual(1000);
    expect(Math.abs((changes[1]?.timeMs ?? 0) - 108_000)).toBeLessThanOrEqual(1000);
  });
});

describe('ground track', () => {
  it('over one ISS orbit reaches about the inclination in latitude, and splits at the antimeridian', () => {
    if (!satrec || !iss) throw new Error('no ISS in the fixture');
    const periodMs = (1440 / iss.MEAN_MOTION) * 60_000;
    const points = groundTrackPoints(satrec, T0, T0 + periodMs, 360);
    expect(points).toHaveLength(361);
    const maxLat = Math.max(...points.map((p) => Math.abs(p.latDeg)));
    expect(maxLat).toBeGreaterThan(iss.INCLINATION - 0.5);
    expect(maxLat).toBeLessThan(iss.INCLINATION + 0.5);
    const geo = trackGeoJson([
      { time: '', latDeg: 10, lonDeg: 170, heightKm: 400 },
      { time: '', latDeg: 20, lonDeg: -170, heightKm: 400 },
      { time: '', latDeg: 30, lonDeg: -150, heightKm: 400 },
    ]);
    expect(geo.coordinates).toHaveLength(2);
    expect(geo.coordinates[0]?.at(-1)).toEqual([180, 15]);
    expect(geo.coordinates[1]?.[0]).toEqual([-180, 15]);
  });
});

describe('closest approach', () => {
  it('finds the minimum of a distance to the second', async () => {
    const tMin = 37_000_123;
    const minima = await closestApproaches({
      // Two objects 5 km apart at their closest, passing at 7 km/s.
      distanceKm: (ms) => Math.hypot(5, ((ms - tMin) / 1000) * 7),
      startMs: 0,
      endMs: 86_400_000,
      maxRelativeSpeedKmS: 16,
      minStepMs: 1000,
      maxStepMs: 600_000,
      limit: 3,
    });
    expect(Math.abs((minima[0]?.timeMs ?? 0) - tMin)).toBeLessThan(50);
    expect(minima[0]?.distanceKm).toBeLessThan(5.001);
  });
});

describe('sky conjunctions', () => {
  it('finds the Moon passing Neptune in October 2026, with astronomy-engine’s separation', () => {
    const observer = new Astronomy.Observer(45.5, -73.57, 0);
    const found = skyConjunctions({
      latDeg: 45.5,
      lonDeg: -73.57,
      startMs: Date.parse('2026-10-21T00:00:00Z'),
      endMs: Date.parse('2026-10-26T00:00:00Z'),
      maxSeparationDeg: 5,
      lang: 'en',
    });
    const pair = found.find(
      (c) => (c['objects'] as { id: string }[]).map((o) => o.id).join() === 'moon,neptune',
    );
    if (!pair) throw new Error('no Moon–Neptune pairing');
    const time = Astronomy.MakeTime(new Date(String(pair['time'])));
    const v = (body: Astronomy.Body) => {
      const eq = Astronomy.Equator(body, time, observer, false, true);
      return Astronomy.VectorFromSphere(new Astronomy.Spherical(eq.dec, eq.ra * 15, 1), time);
    };
    const sep = Astronomy.AngleBetween(v(Astronomy.Body.Moon), v(Astronomy.Body.Neptune));
    expect(Number(pair['separationDeg'])).toBeCloseTo(sep, 1);
    // At its smallest: a little earlier or later is wider.
    const later = Astronomy.MakeTime(new Date(Date.parse(String(pair['time'])) + 3 * 3_600_000));
    const vl = (body: Astronomy.Body) => {
      const eq = Astronomy.Equator(body, later, observer, false, true);
      return Astronomy.VectorFromSphere(new Astronomy.Spherical(eq.dec, eq.ra * 15, 1), later);
    };
    expect(Astronomy.AngleBetween(vl(Astronomy.Body.Moon), vl(Astronomy.Body.Neptune))).toBeGreaterThan(sep);
  });
});

describe("texts in the user's language", () => {
  it('writes compass points the French way (O for west), codes unchanged in English', () => {
    expect(compassLabel('WNW', 'fr')).toBe('ONO');
    expect(compassLabel('SSW', 'fr')).toBe('SSO');
    expect(compassLabel('W', 'en')).toBe('W');
    expect(compassLabel('NE', 'fr')).toBe('NE');
  });

  it('has every note in English and French', () => {
    for (const [key, text] of Object.entries(NOTES)) {
      expect(text.en.length, key).toBeGreaterThan(40);
      expect(text.fr.length, key).toBeGreaterThan(40);
      expect(text.fr, key).not.toBe(text.en);
    }
  });
});
