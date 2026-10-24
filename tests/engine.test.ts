import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import * as Astronomy from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { AU_KM } from '../src/astro/constants';
import { GM_KM3_S2 } from '../src/astro/kepler';
import { SHARD_COUNT, shardOf } from '../src/data/shards';
import { createEngine } from '../src/engine';
import type { FetchLike } from '../src/engine/data';

const J2000_JD = 2_451_545.0;
const gp = gzipSync(readFileSync('tests/fixtures/omm-sample.json'));

/**
 * A circular heliocentric orbit at 1.2 AU, sampled hourly over ±5 days around 2026-09-26 (TDB ≈ UTC here): the
 * window is the last 5 days, the first 5 its archive (ephem/past), every 2 hours (a coarser archive step).
 */
const START_JD = Date.parse('2026-09-21T00:00:00Z') / 86_400_000 + 2_440_587.5;
const WINDOW_JD = START_JD + 5;
const orbitRows = (from: number, to: number, stepH: number): Buffer => {
  const r = 1.2 * AU_KM;
  const v = Math.sqrt(GM_KM3_S2.sun / r);
  const n = v / r;
  const rows: number[] = [];
  const count = Math.round(((to - from) * 24) / stepH);
  for (let i = 0; i <= count; i++) {
    const t = from + (i * stepH) / 24;
    const a = n * (t - J2000_JD) * 86_400;
    rows.push(t, r * Math.cos(a), r * Math.sin(a), 0, -v * Math.sin(a), v * Math.cos(a), 0);
  }
  const buf = Buffer.alloc(rows.length * 8);
  rows.forEach((x, i) => buf.writeDoubleLE(x, i * 8));
  return buf;
};
const ephem = orbitRows(WINDOW_JD, START_JD + 10, 1);
const ephemPast = orbitRows(START_JD, WINDOW_JD - 1 / 12, 2);

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** A daily copy of 2026-09-15: the same objects, epochs 11 days earlier, split into shards with their index. */
const history = (() => {
  const omm = (JSON.parse(readFileSync('tests/fixtures/omm-sample.json', 'utf8')) as { EPOCH: string }[]).map(
    (o) => ({ ...o, EPOCH: o.EPOCH.replace('2026-09-26', '2026-09-15') }),
  );
  const whole = gzipSync(JSON.stringify(omm));
  const lists: unknown[][] = Array.from({ length: SHARD_COUNT }, () => []);
  for (const o of omm as unknown as { NORAD_CAT_ID: number }[])
    lists[shardOf(o.NORAD_CAT_ID, SHARD_COUNT)]?.push(o);
  const shards = lists.map((l) => gzipSync(JSON.stringify(l)));
  const index = gzipSync(JSON.stringify({ parent: sha(whole), sha256: shards.map(sha) }));
  const files: Record<string, Buffer> = {
    'data/earth/history/2026-09-15.json.gz': whole,
    'data/earth/history/2026-09-15/index.json.gz': index,
  };
  shards.forEach((b, i) => (files[`data/earth/history/2026-09-15/${i}.json.gz`] = b));
  return {
    files,
    entry: {
      date: '2026-09-15',
      path: 'earth/history/2026-09-15.json.gz',
      fetchedAt: '2026-09-15T22:00:00.000Z',
      count: omm.length,
      bytes: whole.length,
      sha256: sha(whole),
      shards: {
        count: SHARD_COUNT,
        path: 'earth/history/2026-09-15/{shard}.json.gz',
        index: 'earth/history/2026-09-15/index.json.gz',
        indexSha256: sha(index),
      },
    },
  };
})();
const manifest = {
  version: 1,
  generatedAt: '2026-09-26T12:00:00Z',
  earthHistory: { days: 30, snapshots: [history.entry] },
  datasets: {
    'earth.gp': {
      path: 'earth/gp.json.gz',
      source: 'CelesTrak',
      fetchedAt: '2026-09-26T12:00:00Z',
      count: 3,
      bytes: gp.length,
      sha256: sha(gp),
    },
  },
  ephemerides: {
    'voyager-1': {
      path: 'ephem/voyager-1.bin',
      source: 'Horizons',
      fetchedAt: '2026-09-26T03:00:00Z',
      count: ephem.length / 56,
      bytes: ephem.length,
      sha256: sha(ephem),
      horizonsId: '-31',
      center: '500@10',
      centralBody: 'sun',
      startTdbJd: WINDOW_JD,
      endTdbJd: START_JD + 10,
      stepMin: 60,
      past: {
        path: 'ephem/past/voyager-1.bin',
        bytes: ephemPast.length,
        sha256: sha(ephemPast),
        count: ephemPast.length / 56,
        startTdbJd: START_JD,
        endTdbJd: WINDOW_JD - 1 / 12,
        stepMin: 120,
      },
    },
  },
};

const files: Record<string, Buffer> = {
  'data/manifest.json': Buffer.from(JSON.stringify(manifest)),
  'data/earth/gp.json.gz': gp,
  'data/ephem/voyager-1.bin': ephem,
  'data/ephem/past/voyager-1.bin': ephemPast,
  ...history.files,
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

describe('engine past satellite elements', () => {
  it("reads a past date's daily copy from its own shard, and says so", async () => {
    requested.length = 0;
    const s = await engine.state('25544', '2026-09-15T12:00:00Z');
    const p = s.provenance[0];
    expect(p?.elementSet).toBe('archive 2026-09-15');
    expect(p?.elementEpoch?.slice(0, 10)).toBe('2026-09-15');
    expect(p?.dataFetchedAt).toBe('2026-09-15T22:00:00.000Z');
    expect(p?.state).toBe('fresh');
    expect(requested).toContain(`data/earth/history/2026-09-15/${shardOf(25544, SHARD_COUNT)}.json.gz`);
    expect(requested).not.toContain('data/earth/history/2026-09-15.json.gz');
    // The current set for recent dates.
    const now = await engine.state('25544', '2026-09-26T10:00:00Z');
    expect(now.provenance[0]?.elementSet).toBe('current');
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

  it('reads the 30-day archive only before the window, as archived Horizons vectors', async () => {
    requested.length = 0;
    await engine.state('voyager-1', '2026-09-27T00:00:00Z', 'sun');
    expect(requested).not.toContain('data/ephem/past/voyager-1.bin');
    const s = await engine.state('voyager-1', '2026-09-22T05:00:00Z', 'sun');
    expect(requested).toContain('data/ephem/past/voyager-1.bin');
    expect(s.distanceAu).toBeCloseTo(1.2, 6);
    expect(s.provenance[0]?.state).toBe('interpolated');
    expect(s.provenance[0]?.method).toMatch(/Archived JPL Horizons/);
    // The archive's first state (TDB, a minute after UTC).
    const from = Date.parse(s.provenance[0]?.validFrom ?? '');
    expect(Math.abs(from - Date.parse('2026-09-21T00:00:00Z'))).toBeLessThan(120_000);
    // Across the joint (2-hour archive step, then the hourly window): still interpolated.
    expect((await engine.state('voyager-1', '2026-09-25T23:30:00Z', 'sun')).provenance[0]?.state).toBe(
      'interpolated',
    );
    // Before the archive: extrapolated from its first state.
    const before = await engine.state('voyager-1', '2026-09-19T00:00:00Z', 'sun');
    expect(before.provenance[0]?.state).toBe('extrapolated');
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

describe('engine passes', () => {
  it('gives local times that follow daylight saving (Toronto, 1 November 2026)', async () => {
    const zone = 'America/Toronto';
    const r = (await engine.passes('25544', {
      latDeg: 43.65,
      lonDeg: -79.38,
      start: '2026-10-30T00:00:00Z',
      days: 4,
      timeZone: zone,
    })) as { passes: { rise: { time: string; local: string } }[] };
    expect(r.passes.length).toBeGreaterThan(4);
    const intl = new Intl.DateTimeFormat('sv-SE', {
      timeZone: zone,
      dateStyle: 'short',
      timeStyle: 'medium',
    });
    for (const p of r.passes) expect(p.rise.local).toBe(intl.format(new Date(p.rise.time)));
  });

  it('refuses what is not an Earth satellite and bad places', async () => {
    await expect(engine.passes('mars', { latDeg: 0, lonDeg: 0 })).rejects.toThrow(/Earth satellites/);
    await expect(engine.passes('25544', { latDeg: 95, lonDeg: 0 })).rejects.toThrow(/latitude/);
    await expect(
      engine.passes('25544', { latDeg: 0, lonDeg: 0, timeZone: 'Mars/Olympus' }),
    ).rejects.toThrow();
  });
});

describe('engine view descriptions', () => {
  it('describes an embed of a satellite in English', async () => {
    const d = await engine.describeView(
      'https://perigee.info/?embed=1&sel=25544&follow=1&t=2026-09-26T10:00:00Z&rate=60&frame=inertial',
      'en',
    );
    expect(d['altText']).toBe(
      'Perigee 3D Earth view on 26 September 2026 at 10:00 UTC, following International Space Station (ISS).',
    );
    const text = String(d['description']);
    expect(text).toMatch(/km up/);
    expect(text).toMatch(/computed from recent orbital elements/);
    expect(text).toMatch(/1 minute per second \(×60\)/);
    expect(text).toMatch(/Inertial frame/);
    expect(text).toMatch(/Embedded view without bars or panels/);
    expect(d['url']).toBe(
      'https://example.test/?sel=25544&follow=1&t=2026-09-26T10%3A00%3A00Z&rate=60&frame=inertial',
    );
  });

  it('describes filters, scales and hidden missions in French', async () => {
    const earth = await engine.describeView('?op=spacex&reg=LEO&q=starlink&ls=0', 'fr', 'America/Toronto');
    expect(String(earth['description'])).toContain(
      'Seuls les satellites répondant à ces filtres sont affichés : opérateur SpaceX ; orbites LEO ; recherche « starlink ».',
    );
    expect(String(earth['description'])).toContain('Les sites de lancement sont masqués.');
    const solar = await engine.describeView(
      '?view=solar&sel=mars&log=1&hide=juno&t=2026-12-01T00:00:00Z&rate=0',
      'fr',
    );
    const text = String(solar['description']);
    expect(text).toMatch(/Objet sélectionné : Mars, à 1,6\d ua du Soleil/);
    expect(text).toMatch(/échelle logarithmique/);
    expect(text).toMatch(/Missions masquées : Juno\./);
    expect(text).toMatch(/temps arrêté/);
  });

  it('places the Mercury, Venus and Titan sites on their body, shown in the solar view', async () => {
    const venera = await engine.state('site:venera-13', '2026-09-26T00:00:00Z');
    expect(venera.centre).toBe('venus');
    expect(venera.distanceKm).toBeCloseTo(6051.8, 0);
    expect(venera.provenance[0]?.model).toBe('site-coordinates');
    const messenger = await engine.state('site:messenger-impact', '2026-09-26T00:00:00Z');
    expect(messenger.centre).toBe('mercury');
    expect(messenger.distanceKm).toBeCloseTo(2439.7, 0);
    const huygens = await engine.state('site:huygens', '2026-09-26T00:00:00Z');
    expect(huygens.centre).toBe('moon:titan');
    expect(huygens.distanceKm).toBeCloseTo(2574.7, 0);
    const found = await engine.find('Huygens');
    expect(found.map((r) => r.id)).toContain('site:huygens');
    const view = await engine.describeView('?view=solar&sel=site:venera-13&sites=1', 'en');
    expect(String(view['description'])).toMatch(/Venera 13/);
    expect(String(view['description'])).toMatch(/marked on its surface/);
  });

  it('names a landing site and says when a position is unknown', async () => {
    const site = await engine.describeView('?view=moon&sel=site:apollo-11', 'en');
    expect(String(site['description'])).toMatch(/Apollo 11, crewed landing site, 1969-07-20/);
    const lost = await engine.describeView('?view=solar&sel=voyager-1&t=2026-11-30T00:00:00Z', 'en');
    expect(String(lost['description'])).toMatch(/unknown at this date/);
    const bad = await engine.describeView('?sel=nonexistent-probe', 'en');
    expect(String(bad['description'])).toMatch(/not recognised/);
  });
});

describe('engine misc', () => {
  it('builds view links', () => {
    expect(
      engine.viewUrl('25544', { date: new Date('2026-09-26T10:00:00Z'), embed: true, follow: true }),
    ).toBe('https://example.test/?sel=25544&t=2026-09-26T10%3A00%3A00Z&follow=1&embed=1');
    expect(engine.viewUrl('moon')).toBe('https://example.test/?sel=moon');
    // A star's 3D map with the Sun, another star compared, no follow (the map has its own camera).
    expect(
      engine.viewUrl('star:sirius', { starMap: true, compare: 'star:vega', follow: true, embed: true }),
    ).toBe('https://example.test/?view=solar&sel=star%3Asirius&map=1&pick=star%3Avega&embed=1');
    expect(() => engine.viewUrl('mars', { starMap: true })).toThrow(/star map needs a star/);
    expect(() => engine.viewUrl('star:sirius', { starMap: true, compare: 'mars' })).toThrow(/Only a star/);
  });

  it('describes a star map link', async () => {
    const d = await engine.describeView('?view=solar&sel=star:sirius&map=1&pick=star:vega&embed=1', 'fr');
    expect(String(d['altText'])).toBe(
      'Carte 3D de Périgée : Sirius et le Soleil, à 8,6 années-lumière l’un de l’autre, comparée à Véga (25 années-lumière), parmi les étoiles nommées autour du Soleil.',
    );
    expect(String(d['description'])).toMatch(/tige de chaque étoile/);
    expect(d['parameters']).toMatchObject({ starMap: { star: 'star:sirius', pick: 'star:vega' } });
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

describe('engine on sharded data (hosted endpoint budget)', () => {
  type Rec = { NORAD_CAT_ID: number; OBJECT_NAME: string; OBJECT_ID: string };
  const omm = JSON.parse(readFileSync('tests/fixtures/omm-sample.json', 'utf8')) as Rec[];
  const count = 4;
  const shardFiles: Record<string, Buffer> = {};
  for (let k = 0; k < count; k++)
    shardFiles[`data/earth/gp-active/${k}.json.gz`] = gzipSync(
      JSON.stringify(omm.filter((o) => o.NORAD_CAT_ID % count === k)),
    );
  const sharded = {
    ...manifest,
    datasets: {
      'earth.gp': {
        ...manifest.datasets['earth.gp'],
        shards: { count, path: 'earth/gp-active/{shard}.json.gz' },
        names: 'earth/gp-names.txt.gz',
      },
    },
  };
  const shardedFiles: Record<string, Buffer> = {
    'data/manifest.json': Buffer.from(JSON.stringify(sharded)),
    'data/earth/gp-names.txt.gz': gzipSync(
      omm.map((o) => `${o.NORAD_CAT_ID}\t${o.OBJECT_NAME}\t${o.OBJECT_ID}`).join('\n'),
    ),
    ...shardFiles,
  };
  const paths: string[] = [];
  const shardedFetch: FetchLike = async (url) => {
    const path = new URL(url).pathname.slice(1);
    paths.push(path);
    const body = shardedFiles[path];
    return {
      ok: body !== undefined,
      status: body ? 200 : 404,
      arrayBuffer: async () =>
        body
          ? (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer)
          : new ArrayBuffer(0),
    };
  };
  const shardedEngine = createEngine({ baseUrl: 'https://example.test/', fetch: shardedFetch });

  it('reads only the satellite’s shard', async () => {
    const s = await shardedEngine.state('25544', '2026-09-26T10:00:00Z');
    expect(s.altitudeKm).toBeGreaterThan(370);
    expect(paths).toEqual(['data/manifest.json', `data/earth/gp-active/${25544 % count}.json.gz`]);
    const missing = await shardedEngine.state('99999', '2026-09-26T10:00:00Z');
    expect(missing.provenance[0]?.state).toBe('none');
  });

  it('searches names in the index, by name, NORAD or COSPAR id', async () => {
    expect((await shardedEngine.find('zarya')).map((f) => f.id)).toContain('25544');
    expect((await shardedEngine.find('100830')).map((f) => f.id)).toEqual(['100830']);
    expect((await shardedEngine.find('1998-067a')).map((f) => f.id)).toContain('25544');
    expect(paths.filter((p) => p === 'data/earth/gp.json.gz')).toEqual([]);
  });
});

describe('engine data integrity', () => {
  const body = (b: Buffer | undefined) => ({
    ok: b !== undefined,
    status: b ? 200 : 404,
    arrayBuffer: async () =>
      b ? (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) : new ArrayBuffer(0),
  });

  it('adds the final slash to a site address', () => {
    expect(createEngine({ baseUrl: 'https://perigee.info' }).data.baseUrl).toBe('https://perigee.info/');
  });

  it('refuses a file that does not match the manifest, and caches nothing', async () => {
    const other = gzipSync(Buffer.from('[]'));
    const served: Record<string, Buffer> = { ...files, 'data/earth/gp.json.gz': other };
    const stored: string[] = [];
    const e = createEngine({
      baseUrl: 'https://example.test/',
      fetch: async (url) => body(served[new URL(url).pathname.slice(1)]),
      cache: { get: async () => undefined, set: async (k) => void stored.push(k) },
    });
    await expect(e.state('25544', '2026-09-26T10:00:00Z')).rejects.toThrow(/being updated/);
    expect(stored.filter((k) => k.startsWith('earth/gp.json.gz'))).toEqual([]);
  });

  it('uses .gz files a server decompressed in transit, without caching them (Vite dev and preview)', async () => {
    const decoded: Record<string, Buffer> = {
      ...files,
      'data/earth/gp.json.gz': readFileSync('tests/fixtures/omm-sample.json'),
    };
    const stored: string[] = [];
    const e = createEngine({
      baseUrl: 'https://example.test/',
      fetch: async (url) => body(decoded[new URL(url).pathname.slice(1)]),
      cache: { get: async () => undefined, set: async (k) => void stored.push(k) },
    });
    expect((await e.state('25544', '2026-09-26T10:00:00Z')).altitudeKm).toBeGreaterThan(370);
    expect(stored).toEqual([]);
  });

  it('drops a cached copy that no longer matches and downloads it again', async () => {
    const deleted: string[] = [];
    const e = createEngine({
      baseUrl: 'https://example.test/',
      fetch: async (url) => body(files[new URL(url).pathname.slice(1)]),
      cache: {
        get: async (k) => (k.startsWith('earth/gp.json.gz') ? new ArrayBuffer(8) : undefined),
        set: async () => undefined,
        delete: async (k) => void deleted.push(k),
      },
    });
    const s = await e.state('25544', '2026-09-26T10:00:00Z');
    expect(s.altitudeKm).toBeGreaterThan(370);
    expect(deleted).toEqual([`earth/gp.json.gz@${sha(gp).slice(0, 16)}`]);
  });

  it('checks each shard against the shard index and keeps one data version in memory', async () => {
    type Rec = { NORAD_CAT_ID: number };
    const omm = JSON.parse(readFileSync('tests/fixtures/omm-sample.json', 'utf8')) as Rec[];
    const count = 4;
    const build = (records: Rec[], parentSeed: string) => {
      const parent = createHash('sha256').update(parentSeed).digest('hex');
      const shards = Array.from({ length: count }, (_, k) =>
        gzipSync(JSON.stringify(records.filter((o) => o.NORAD_CAT_ID % count === k))),
      );
      const index = gzipSync(JSON.stringify({ parent, sha256: shards.map(sha) }));
      const entry = {
        ...manifest.datasets['earth.gp'],
        sha256: parent,
        shards: {
          count,
          path: 'earth/s/{shard}.json.gz',
          index: 'earth/s/index.json.gz',
          indexSha256: sha(index),
        },
      };
      const out: Record<string, Buffer> = {
        'data/manifest.json': Buffer.from(JSON.stringify({ ...manifest, datasets: { 'earth.gp': entry } })),
        'data/earth/s/index.json.gz': index,
      };
      shards.forEach((b, k) => (out[`data/earth/s/${k}.json.gz`] = b));
      return out;
    };
    let served = build(omm, 'v1');
    const e = createEngine({
      baseUrl: 'https://example.test/',
      fetch: async (url) => body(served[new URL(url).pathname.slice(1)]),
      manifestTtlMs: 0,
    });
    expect((await e.state('25544', '2026-09-26T10:00:00Z')).altitudeKm).toBeGreaterThan(370);
    await e.state('100830', '2026-09-26T06:00:00Z');
    expect(e.data.memoryEntries().shards).toBe(2);

    // A shard of another version under the same name: refused, not mixed in.
    const tampered = { ...served, [`data/earth/s/${25544 % count}.json.gz`]: gzipSync('[]') };
    served = {
      ...build(omm, 'v2'),
      [`data/earth/s/${25544 % count}.json.gz`]: tampered[`data/earth/s/${25544 % count}.json.gz`] as Buffer,
    };
    await expect(e.state('25544', '2026-09-26T10:00:00Z')).rejects.toThrow(/being updated/);
    // The new version replaced the old one in memory.
    await e.state('100830', '2026-09-26T06:00:00Z');
    expect(e.data.memoryEntries().shards).toBe(1);
    expect(e.data.memoryEntries().shardIndexes).toBe(1);
  });
});
