import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import * as Astronomy from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { AU_KM } from '../src/astro/constants';
import { GM_KM3_S2 } from '../src/astro/kepler';
import { createEngine } from '../src/engine';
import type { FetchLike } from '../src/engine/data';

const J2000_JD = 2_451_545.0;
const gp = gzipSync(readFileSync('tests/fixtures/omm-sample.json'));

/** A circular heliocentric orbit at 1.2 AU, sampled hourly over ±5 days around 2026-09-26 (TDB ≈ UTC here). */
const START_JD = Date.parse('2026-09-21T00:00:00Z') / 86_400_000 + 2_440_587.5;
const ephem = (() => {
  const r = 1.2 * AU_KM;
  const v = Math.sqrt(GM_KM3_S2.sun / r);
  const n = v / r;
  const rows: number[] = [];
  for (let i = 0; i <= 240; i++) {
    const t = START_JD + i / 24;
    const a = n * (t - J2000_JD) * 86_400;
    rows.push(t, r * Math.cos(a), r * Math.sin(a), 0, -v * Math.sin(a), v * Math.cos(a), 0);
  }
  const buf = Buffer.alloc(rows.length * 8);
  rows.forEach((x, i) => buf.writeDoubleLE(x, i * 8));
  return buf;
})();

const sha = (c: string): string => c.repeat(64);
const manifest = {
  version: 1,
  generatedAt: '2026-09-26T12:00:00Z',
  datasets: {
    'earth.gp': {
      path: 'earth/gp.json.gz',
      source: 'CelesTrak',
      fetchedAt: '2026-09-26T12:00:00Z',
      count: 3,
      bytes: gp.length,
      sha256: sha('a'),
    },
  },
  ephemerides: {
    'voyager-1': {
      path: 'ephem/voyager-1.bin',
      source: 'Horizons',
      fetchedAt: '2026-09-26T03:00:00Z',
      count: 241,
      bytes: ephem.length,
      sha256: sha('b'),
      horizonsId: '-31',
      center: '500@10',
      centralBody: 'sun',
      startTdbJd: START_JD,
      endTdbJd: START_JD + 10,
      stepMin: 60,
    },
  },
};

const files: Record<string, Buffer> = {
  'data/manifest.json': Buffer.from(JSON.stringify(manifest)),
  'data/earth/gp.json.gz': gp,
  'data/ephem/voyager-1.bin': ephem,
};
const requested: string[] = [];
const fakeFetch: FetchLike = async (url) => {
  const path = new URL(url).pathname.slice(1);
  requested.push(path);
  const body = files[path];
  return {
    ok: body !== undefined,
    status: body ? 200 : 404,
    arrayBuffer: async () =>
      body ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new ArrayBuffer(0),
  } as Awaited<ReturnType<FetchLike>>;
};
const engine = createEngine({ baseUrl: 'https://example.test/', fetch: fakeFetch });

describe('engine distances', () => {
  it('Earth–Mars distance matches astronomy-engine', async () => {
    const date = new Date('2026-12-01T00:00:00Z');
    const d = await engine.distance('earth', 'mars', date);
    const e = Astronomy.HelioVector(Astronomy.Body.Earth, date);
    const m = Astronomy.HelioVector(Astronomy.Body.Mars, date);
    const expectedAu = Math.hypot(e.x - m.x, e.y - m.y, e.z - m.z);
    expect(d.distanceAu).toBeCloseTo(expectedAu, 6);
    expect(d.lightTimeS).toBeCloseTo((expectedAu * AU_KM) / 299_792.458, 0);
    expect(d.provenance.map((p) => p.model)).toEqual(['vsop87', 'vsop87']);
    expect(d.disclaimer).toMatch(/Educational/);
  });

  it('the Moon is about 384 000 km from the Earth', async () => {
    const s = await engine.state('moon', '2026-09-26T00:00:00Z');
    expect(s.centre).toBe('earth');
    expect(s.distanceKm).toBeGreaterThan(356_000);
    expect(s.distanceKm).toBeLessThan(407_000);
    expect(s.provenance[0]?.model).toBe('astronomy-engine-moon');
  });

  it('a distance series finds the closest sample', async () => {
    const s = await engine.series('earth', 'mars', '2026-01-01T00:00:00Z', '2028-01-01T00:00:00Z', 100);
    expect(s.points).toHaveLength(101);
    // Mars opposition: February 2027.
    expect(s.closest?.date.slice(0, 7)).toMatch(/^2027-0[12]/);
    expect(s.farthest?.distanceKm).toBeGreaterThan(s.closest?.distanceKm ?? Infinity);
  });
});

describe('engine satellites', () => {
  it('ISS state from the published GP elements', async () => {
    const s = await engine.state('25544', '2026-09-26T10:00:00Z');
    expect(s.centre).toBe('earth');
    expect(s.altitudeKm).toBeGreaterThan(370);
    expect(s.altitudeKm).toBeLessThan(440);
    expect(s.speedKmS).toBeGreaterThan(7.6);
    expect(s.speedKmS).toBeLessThan(7.75);
    const [p] = s.provenance;
    if (!p) throw new Error('no provenance');
    expect(p.model).toBe('sgp4-gp');
    expect(p.state).toBe('fresh');
    expect(p.dataFetchedAt).toBe('2026-09-26T12:00:00Z');
    expect(p.elementAgeDays).toBeCloseTo(0.017, 2);
    expect(p.accuracy.typicalKm).toBe(1);
  });

  it('flags elements older than 14 days as stale', async () => {
    const s = await engine.state('25544', '2026-10-15T00:00:00Z');
    expect(s.provenance[0]?.state).toBe('stale');
  });

  it('ingests 6-digit catalogue numbers', async () => {
    const s = await engine.state('100830', '2026-09-26T06:00:00Z');
    expect(s.distanceKm).toBeGreaterThan(6378);
  });

  it('finds satellites by name and catalogue objects first', async () => {
    expect((await engine.find('zarya')).map((f) => f.id)).toContain('25544');
    expect((await engine.find('mars'))[0]?.id).toBe('mars');
  });
});

describe('engine probes', () => {
  it('interpolates Horizons vectors inside the window', async () => {
    const s = await engine.state('voyager-1', '2026-09-26T00:30:00Z', 'sun');
    expect(s.distanceAu).toBeCloseTo(1.2, 6);
    const [p] = s.provenance;
    if (!p) throw new Error('no provenance');
    expect(p.model).toBe('horizons-interpolated');
    expect(p.state).toBe('interpolated');
    expect(p.hoursBeyondWindow).toBeUndefined();
  });

  it('extrapolates past the window, then hides', async () => {
    const after = await engine.state('voyager-1', '2026-10-03T00:00:00Z', 'sun');
    expect(after.provenance[0]?.state).toBe('extrapolated');
    expect(after.provenance[0]?.hoursBeyondWindow).toBeGreaterThan(24);
    expect(after.distanceAu).toBeCloseTo(1.2, 3);
    const late = await engine.state('voyager-1', '2026-11-30T00:00:00Z', 'sun');
    expect(late.provenance[0]?.state).toBe('hidden');
    expect(late.distanceKm).toBeUndefined();
  });

  it('says when a mission has no public ephemeris', async () => {
    const s = await engine.state('queqiao-2', '2026-09-26T00:00:00Z');
    expect(s.provenance[0]?.state).toBe('none');
    expect(s.distanceKm).toBeUndefined();
  });

  it('describes a mission with its goals, sources and view link', async () => {
    const d = await engine.describe('voyager-1', 'fr');
    expect(d.name).toMatch(/Voyager/);
    expect(d.sources).toBeInstanceOf(Array);
    expect(d.view).toBe('https://example.test/?view=solar&sel=voyager-1&lang=fr');
  });
});

describe('engine misc', () => {
  it('builds view links', () => {
    expect(
      engine.viewUrl('25544', { date: new Date('2026-09-26T10:00:00Z'), embed: true, follow: true }),
    ).toBe('https://example.test/?sel=25544&t=2026-09-26T10%3A00%3A00Z&follow=1&embed=1');
    expect(engine.viewUrl('moon')).toBe('https://example.test/?sel=moon');
  });

  it('defines glossary terms in both languages', () => {
    expect(engine.define().length).toBeGreaterThan(10);
    expect(engine.define('apogée', 'fr')[0]?.term).toBe('apsides');
    expect(engine.define('Altitude')[0]?.labels).toContain('Altitude');
  });

  it('never contacts the providers', () => {
    expect(requested.every((p) => p.startsWith('data/'))).toBe(true);
  });

  it('rejects unknown objects', async () => {
    await expect(engine.state('nonexistent-probe')).rejects.toThrow(/Unknown object/);
  });
});
