import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import * as Astronomy from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { publishDatasets, writeStats } from '../pipeline/publish';
import { OmmListSchema, OperatorsCatalogSchema } from '../src/data/schemas';
import { buildCatalog } from '../src/earth/catalog';
import { satelliteStats } from '../src/earth/stats';
import { eventsBetween } from '../src/engine/events';
import { moonPhaseName, skyFrom, skyState } from '../src/engine/sky';

describe('sky from a place', () => {
  const date = new Date('2026-10-20T01:30:00Z'); // 21:30 in Montreal
  const sky = skyFrom({ latDeg: 45.5, lonDeg: -73.57, date, lang: 'en' }) as {
    sky: string;
    sun: { altitudeDeg: number; rise?: { time: string } };
    moon: { phase: string; illuminatedPercent: number };
    planets: { id: string; altitudeDeg: number; nakedEyeNow: boolean; magnitude: number }[];
    brightStars: { id: string; altitudeDeg: number; azimuthDeg: number }[];
  };

  it('tells night from day and names the Moon phase', () => {
    expect(sky.sky).toBe('night (dark sky)');
    expect(sky.sun.altitudeDeg).toBeLessThan(-18);
    expect(sky.sun.rise?.time.slice(0, 10)).toBe('2026-10-20');
    expect(sky.moon.phase).toBe('waxing gibbous');
    expect(sky.moon.illuminatedPercent).toBeGreaterThan(50);
    expect(sky.moon.illuminatedPercent).toBeLessThan(75);
    expect(moonPhaseName(180).fr).toBe('pleine lune');
    expect(skyState(-3)).toBe('civil');
  });

  it('lists the planets with naked-eye visibility', () => {
    expect(sky.planets.map((p) => p.id)).toEqual([
      'mercury',
      'venus',
      'mars',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
    ]);
    for (const p of sky.planets) {
      if (p.altitudeDeg <= 0 || p.magnitude > 6) expect(p.nakedEyeNow).toBe(false);
    }
    expect(sky.planets.find((p) => p.id === 'saturn')?.nakedEyeNow).toBe(true);
  });

  it('places the stars as astronomy-engine’s Horizon() does', () => {
    const observer = new Astronomy.Observer(45.5, -73.57, 0);
    const time = Astronomy.MakeTime(date);
    const vega = sky.brightStars.find((s) => s.id === 'star:vega');
    if (!vega) throw new Error('Vega below the horizon');
    // Vega, J2000 (SIMBAD), precessed to the date.
    const v = Astronomy.RotateVector(
      Astronomy.Rotation_EQJ_EQD(time),
      Astronomy.VectorFromSphere(new Astronomy.Spherical(38.78369, 279.23473, 1), time),
    );
    const eq = Astronomy.EquatorFromVector(v);
    const hor = Astronomy.Horizon(time, observer, eq.ra, eq.dec, 'normal');
    expect(vega.altitudeDeg).toBeCloseTo(hor.altitude, 0);
    expect(vega.azimuthDeg).toBeCloseTo(hor.azimuth, 0);
  });
});

describe('astronomical events', () => {
  const start = new Date('2026-10-19T00:00:00Z');
  const year = eventsBetween({
    start,
    end: new Date(start.getTime() + 366 * 86_400_000),
    lang: 'fr',
    observer: { latDeg: 48.86, lonDeg: 2.35 },
  });
  const find = (re: RegExp) => year.filter((e) => re.test(e.title));

  it('finds the oppositions and eclipses of 2027', () => {
    expect(find(/^Opposition de Mars/)[0]?.time.slice(0, 10)).toBe('2027-02-19');
    // 10 February in the Americas, 11 February in UTC.
    expect(find(/^Opposition de Jupiter/)[0]?.time.slice(0, 10)).toBe('2027-02-11');
    expect(find(/^Opposition d’Uranus/)).toHaveLength(1);
    const total = find(/^Éclipse de Soleil totale/)[0];
    expect(total?.time.slice(0, 10)).toBe('2027-08-02');
    // Partial from Paris (about 0.6 of the Sun's diameter).
    expect(total?.details?.['fromHere']).toMatchObject({ visible: true, kind: 'partial' });
    expect(find(/^Éclipse de Soleil annulaire/)[0]?.time.slice(0, 10)).toBe('2027-02-06');
  });

  it('finds every eclipse astronomy-engine finds (2020–2030), through the ecliptic-latitude shortcut', () => {
    const from = new Date('2020-01-01T00:00:00Z');
    const to = new Date('2030-01-01T00:00:00Z');
    const mine = eventsBetween({ start: from, end: to, lang: 'en', kinds: ['eclipse'] }).map(
      (e) => `${e.title.split(' ')[0]} ${e.time.slice(0, 13)}`,
    );
    const ref: string[] = [];
    for (let e = Astronomy.SearchLunarEclipse(from); e.peak.date < to; e = Astronomy.NextLunarEclipse(e.peak))
      ref.push(`Lunar ${e.peak.date.toISOString().slice(0, 13)}`);
    for (
      let e = Astronomy.SearchGlobalSolarEclipse(from);
      e.peak.date < to;
      e = Astronomy.NextGlobalSolarEclipse(e.peak)
    )
      ref.push(`Solar ${e.peak.date.toISOString().slice(0, 13)}`);
    expect([...mine].sort()).toEqual([...ref].sort());
  });

  it('lists Moon phases, seasons and mission milestones in order', () => {
    expect(find(/^Pleine lune/).length).toBeGreaterThanOrEqual(12);
    expect(find(/^Solstice de décembre/)[0]?.time.slice(0, 10)).toBe('2026-12-21');
    expect(year.some((e) => e.kind === 'mission')).toBe(true);
    const times = year.map((e) => e.time);
    expect([...times].sort()).toEqual(times);
    for (const e of year.filter((x) => x.kind === 'mission'))
      expect(e.time >= start.toISOString().slice(0, 10)).toBe(true);
  });
});

describe('satellite statistics', () => {
  const operators = OperatorsCatalogSchema.parse(JSON.parse(readFileSync('catalog/operators.json', 'utf8')));
  const omm = OmmListSchema.parse(JSON.parse(readFileSync('tests/fixtures/omm-sample.json', 'utf8')));

  it('counts the catalogue by regime and owner', () => {
    const satcat = [
      {
        NORAD_CAT_ID: 25544,
        OBJECT_NAME: 'ISS',
        OBJECT_ID: '1998-067A',
        OBJECT_TYPE: 'PAY',
        OWNER: 'ISS',
        LAUNCH_DATE: '1998-11-20',
      },
    ];
    const stats = satelliteStats(
      buildCatalog(omm, satcat as never, { stations: [25544] }, operators),
      Date.parse('2026-09-26T12:00:00Z'),
    );
    expect(stats.total).toBe(3);
    expect(stats.regimes.LEO).toBe(3);
    expect(stats.owners.find((o) => o.id === 'ISS')?.total).toBe(1);
    expect(stats.groups.find((g) => g.id === 'stations')?.total).toBe(1);
    expect(stats.launchYears['1998']).toBe(1);
  });

  it('is written by the pipeline with a manifest field older clients ignore', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'perigee-stats-'));
    try {
      await publishDatasets(dir, [
        {
          key: 'earth.gp',
          path: 'earth/gp-active.json.gz',
          source: 's',
          fetchedAt: new Date('2026-09-26T12:00:00Z'),
          count: omm.length,
          payload: omm,
        },
      ]);
      await writeStats(dir, operators);
      const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
      expect(manifest.stats.path).toBe('earth/stats.json.gz');
      const stats = JSON.parse(gunzipSync(await readFile(join(dir, manifest.stats.path))).toString());
      expect(stats.total).toBe(3);
      // A second dataset run keeps the field.
      await publishDatasets(dir, [
        {
          key: 'earth.gp',
          path: 'earth/gp-active.json.gz',
          source: 's',
          fetchedAt: new Date('2026-09-26T16:00:00Z'),
          count: omm.length,
          payload: omm,
        },
      ]);
      expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')).stats).toBeDefined();
      await writeFile(join(dir, 'noop'), gzipSync('x'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
