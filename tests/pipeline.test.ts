import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ManifestSchema } from '../src/data/schemas';
import {
  AggregateShrinkError,
  archiveGpSnapshot,
  mergePast,
  publishDatasets,
  publishEphemerides,
  readManifest,
  readRows,
  ShrinkGuardError,
} from '../pipeline/publish';
import { utcToTdbJd } from '../src/astro/time';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'perigee-pipeline-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const dataset = (count: number) => ({
  key: 'earth.gp' as const,
  path: 'earth/gp-active.json.gz',
  source: 'https://example.test/gp',
  fetchedAt: new Date('2026-09-26T00:00:00Z'),
  count,
  payload: Array.from({ length: count }, (_, i) => ({ NORAD_CAT_ID: i + 1 })),
});

describe('publishDatasets', () => {
  it('writes gzip data and a valid manifest with hash and count', async () => {
    const manifest = await publishDatasets(dir, [dataset(10)]);
    expect(ManifestSchema.parse(manifest).datasets['earth.gp']?.count).toBe(10);
    const onDisk = ManifestSchema.parse(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')));
    expect(onDisk.datasets['earth.gp']?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const payload = JSON.parse(gunzipSync(await readFile(join(dir, 'earth/gp-active.json.gz'))).toString());
    expect(payload).toHaveLength(10);
  });

  it('writes split copies by NORAD number and a name index for the machine interfaces', async () => {
    const manifest = await publishDatasets(dir, [
      {
        ...dataset(600),
        shards: {
          path: 'earth/gp-active/{shard}.json.gz',
          norad: (o: { NORAD_CAT_ID: number }) => o.NORAD_CAT_ID,
        },
        names: { path: 'earth/gp-names.txt.gz', text: '1\tA\t1957-001A' },
      },
    ]);
    const entry = ManifestSchema.parse(manifest).datasets['earth.gp'];
    expect(entry?.shards).toMatchObject({
      count: 256,
      path: 'earth/gp-active/{shard}.json.gz',
      index: 'earth/gp-active/index.json.gz',
    });
    expect(entry?.namesSha256).toMatch(/^[0-9a-f]{64}$/);
    const index = JSON.parse(
      gunzipSync(readFileSync(join(dir, 'earth/gp-active/index.json.gz'))).toString(),
    ) as {
      parent: string;
      sha256: string[];
    };
    expect(index.parent).toBe(entry?.sha256);
    expect(index.sha256).toHaveLength(256);
    expect(entry?.names).toBe('earth/gp-names.txt.gz');
    const shard = (k: number): { NORAD_CAT_ID: number }[] =>
      JSON.parse(gunzipSync(readFileSync(join(dir, `earth/gp-active/${k}.json.gz`))).toString());
    // 600 records: shard 88 holds 88, 344 and 600; every record lands in exactly one shard.
    expect(shard(88).map((o) => o.NORAD_CAT_ID)).toEqual([88, 344, 600]);
    expect(Array.from({ length: 256 }, (_, k) => shard(k).length).reduce((a, b) => a + b, 0)).toBe(600);
    expect(gunzipSync(await readFile(join(dir, 'earth/gp-names.txt.gz'))).toString()).toBe('1\tA\t1957-001A');
  });

  it('refuses a dataset below 50 % of the previous one and keeps the old file', async () => {
    await publishDatasets(dir, [dataset(100)]);
    await expect(publishDatasets(dir, [dataset(40)])).rejects.toBeInstanceOf(ShrinkGuardError);
    expect((await readManifest(dir)).datasets['earth.gp']?.count).toBe(100);
    const payload = JSON.parse(gunzipSync(await readFile(join(dir, 'earth/gp-active.json.gz'))).toString());
    expect(payload).toHaveLength(100);
  });

  it('refuses an empty dataset', async () => {
    await expect(publishDatasets(dir, [dataset(0)])).rejects.toBeInstanceOf(ShrinkGuardError);
  });
});

describe('publishEphemerides', () => {
  const ephem = (missionId: string, rows: number, extra: { coverageEnd?: Date; stepMin?: number } = {}) => {
    const data = new Float64Array(rows * 7);
    for (let i = 0; i < rows; i++) data[i * 7] = 2461300 + i;
    return {
      missionId,
      horizonsId: '-1',
      center: '500@10',
      centralBody: 'sun' as const,
      stepMin: extra.stepMin ?? 1440,
      source: 'https://example.test/h',
      fetchedAt: new Date('2026-09-26T00:00:00Z'),
      rows: data,
      bytes: Buffer.from(data.buffer),
      ...(extra.coverageEnd ? { coverageEnd: extra.coverageEnd } : {}),
    };
  };

  it('refuses an unexplained shrink for that mission only, and still publishes the others', async () => {
    await publishEphemerides(dir, [ephem('a', 400), ephem('b', 400)]);
    await expect(publishEphemerides(dir, [ephem('a', 100), ephem('b', 410)])).rejects.toBeInstanceOf(
      AggregateShrinkError,
    );
    const m = await readManifest(dir);
    expect(m.ephemerides['a']?.count).toBe(400);
    expect(m.ephemerides['b']?.count).toBe(410);
  });

  it('accepts a shrink explained by a new coverage end or a coarser step', async () => {
    await publishEphemerides(dir, [ephem('a', 400), ephem('b', 400)]);
    await publishEphemerides(dir, [
      ephem('a', 120, { coverageEnd: new Date('2026-12-01T00:00:00Z') }),
      ephem('b', 100, { stepMin: 4 * 1440 }),
    ]);
    const m = await readManifest(dir);
    expect(m.ephemerides['a']?.count).toBe(120);
    expect(m.ephemerides['b']?.count).toBe(100);
  });
});

describe('daily copies of earth.gp (30 days)', () => {
  const sharded = (fetchedAt: string) => ({
    ...dataset(600),
    fetchedAt: new Date(fetchedAt),
    shards: {
      path: 'earth/gp-active/{shard}.json.gz',
      norad: (o: { NORAD_CAT_ID: number }) => o.NORAD_CAT_ID,
    },
  });

  it("keeps the last set of each UTC day, with its shards, when a later day's first run replaces it", async () => {
    await publishDatasets(dir, [sharded('2026-10-01T08:00:00Z')]);
    // Same day: nothing kept.
    await archiveGpSnapshot(dir, new Date('2026-10-01T20:00:00Z'));
    await publishDatasets(dir, [sharded('2026-10-01T20:00:00Z')]);
    expect((await readManifest(dir)).earthHistory).toBeUndefined();
    // Next day: the 20:00 set is kept as the copy of 2026-10-01.
    await archiveGpSnapshot(dir, new Date('2026-10-02T00:05:00Z'));
    await publishDatasets(dir, [sharded('2026-10-02T00:05:00Z')]);
    const m = await readManifest(dir);
    const snap = m.earthHistory?.snapshots[0];
    expect(m.earthHistory?.snapshots).toHaveLength(1);
    expect(snap).toMatchObject({ date: '2026-10-01', fetchedAt: '2026-10-01T20:00:00.000Z', count: 600 });
    expect(existsSync(join(dir, 'earth/history/2026-10-01.json.gz'))).toBe(true);
    expect(snap?.shards?.path).toBe('earth/history/2026-10-01/{shard}.json.gz');
    expect(existsSync(join(dir, 'earth/history/2026-10-01/index.json.gz'))).toBe(true);
    // The copy's shard index still names the copied set as its parent.
    const index = JSON.parse(
      gunzipSync(await readFile(join(dir, 'earth/history/2026-10-01/index.json.gz'))).toString(),
    );
    expect(index.parent).toBe(snap?.sha256);
    // A second run the same day does not copy again.
    await archiveGpSnapshot(dir, new Date('2026-10-02T04:05:00Z'));
    expect((await readManifest(dir)).earthHistory?.snapshots).toHaveLength(1);
  });

  it('deletes the copies older than 30 days', async () => {
    await publishDatasets(dir, [sharded('2026-10-01T20:00:00Z')]);
    await archiveGpSnapshot(dir, new Date('2026-10-02T00:05:00Z'));
    expect(existsSync(join(dir, 'earth/history/2026-10-01.json.gz'))).toBe(true);
    await archiveGpSnapshot(dir, new Date('2026-11-05T00:05:00Z'));
    expect((await readManifest(dir)).earthHistory).toBeUndefined();
    expect(existsSync(join(dir, 'earth/history/2026-10-01.json.gz'))).toBe(false);
    expect(existsSync(join(dir, 'earth/history/2026-10-01'))).toBe(false);
  });
});

describe('ephemeris archive (30 days)', () => {
  /** Rows every `stepDays` over [from, to] (JD TDB); x carries the time, to trace where a row came from. */
  const rows = (from: number, to: number, stepDays: number, tag = 0): Float64Array => {
    const out: number[] = [];
    const n = Math.round((to - from) / stepDays);
    for (let i = 0; i <= n; i++) out.push(from + i * stepDays, from + i * stepDays + tag, 0, 0, 0, 0, 0);
    return Float64Array.from(out);
  };
  const times = (r: Float64Array): number[] => Array.from({ length: r.length / 7 }, (_, i) => r[i * 7] ?? 0);

  it('merges oldest first, a later source owning its own span, and trims to the cutoff', () => {
    const past = rows(10, 14, 1, 0.1); // archive
    const main = rows(14, 20, 0.5, 0.2); // previous window
    const fill = rows(12, 15, 0.25, 0.3); // one-time Horizons fill
    const merged = mergePast([past, main, fill], 18, 11);
    const t = times(merged);
    expect(t[0]).toBe(11);
    expect(t[t.length - 1]).toBeLessThan(18);
    // Inside the fill's span only its own rows (tag 0.3), never interleaved with the others' grids.
    for (let i = 0; i < merged.length; i += 7) {
      const ti = merged[i] ?? 0;
      const tag = (merged[i + 1] ?? 0) - ti;
      if (ti >= 12 && ti <= 15) expect(tag).toBeCloseTo(0.3, 9);
      if (ti > 15) expect(tag).toBeCloseTo(0.2, 9);
      if (ti < 12) expect(tag).toBeCloseTo(0.1, 9);
    }
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(new Set(t).size).toBe(t.length);
  });

  it('keeps the rows leaving the window run after run, and drops those older than 30 days', async () => {
    const day0 = new Date('2026-10-01T00:00:00Z');
    const window = (now: Date) => {
      const jd = utcToTdbJd(now);
      const data = rows(jd - 1, jd + 3, 1 / 24);
      return {
        missionId: 'lro',
        horizonsId: '-85',
        center: '500@301',
        centralBody: 'moon' as const,
        stepMin: 60,
        source: 'https://example.test/h',
        fetchedAt: now,
        rows: data,
        bytes: Buffer.from(data.buffer),
      };
    };
    for (let d = 0; d < 3; d++) {
      const now = new Date(day0.getTime() + d * 86_400_000);
      await publishEphemerides(dir, [window(now)], now);
    }
    let m = await readManifest(dir);
    const past = m.ephemerides['lro']?.past;
    expect(past?.path).toBe('ephem/past/lro.bin');
    // Two days left the window (day 0 and day 1's first day), hourly.
    expect(past?.count).toBe(48);
    expect(past?.endTdbJd).toBeLessThan(m.ephemerides['lro']?.startTdbJd ?? 0);
    const file = readRows(await readFile(join(dir, past?.path ?? '')));
    expect(file.length / 7).toBe(48);
    // 42 days later (runs missed): every archived row is older than 30 days, so the archive goes.
    const late = new Date(day0.getTime() + 42 * 86_400_000);
    await publishEphemerides(dir, [window(late)], late);
    m = await readManifest(dir);
    expect(ManifestSchema.parse(m).ephemerides['lro']?.past).toBeUndefined();
    expect(existsSync(join(dir, 'ephem/past/lro.bin'))).toBe(false);
  });
});

describe('Horizons parsing', () => {
  const sample = `*******
$$SOE
2461309.509027778, A.D. 2026-Sep-26 00:13:00.0000,  1.362002610539513E+03,  8.782933292672830E+02, -8.928552177142559E+02,  1.0E+00, -2.0E+00,  3.0E-01,
2461309.510416667, A.D. 2026-Sep-26 00:15:00.0000,  1.4E+03,  8.8E+02, -9.0E+02,  1.1E+00, -2.1E+00,  3.1E-01,
$$EOE
*******`;

  it('parses CSV vectors into rows of 7 Float64', async () => {
    const { parseVectors } = await import('../pipeline/horizons');
    const rows = parseVectors(sample);
    expect(rows.length).toBe(14);
    expect(rows[0]).toBeCloseTo(2461309.509027778, 9);
    expect(rows[1]).toBeCloseTo(1362.002610539513, 9);
    expect(rows[6]).toBeCloseTo(0.3, 12);
  });

  it('recognises coverage limits', async () => {
    const { parseCoverageLimit } = await import('../pipeline/horizons');
    const limit = parseCoverageLimit(
      'No ephemeris for target "CAPSTONE (spacecraft)" after A.D. 2026-AUG-14 11:58:59.9999 TDB',
    );
    expect(limit?.kind).toBe('after');
    expect(limit?.date.toISOString()).toBe('2026-08-14T11:58:00.000Z');
    expect(parseCoverageLimit('all good')).toBeUndefined();
  });

  it('writes little-endian Float64 bytes', async () => {
    const { float64LittleEndian } = await import('../pipeline/horizons');
    const buf = float64LittleEndian(Float64Array.from([1.5, -2]));
    expect(buf.readDoubleLE(0)).toBe(1.5);
    expect(buf.readDoubleLE(8)).toBe(-2);
  });
});

describe('rover waypoint feeds', () => {
  it('parses the latest MMGIS waypoint and normalises longitudes', async () => {
    const { parseWaypointFeed } = await import('../pipeline/rovers');
    const feed = {
      type: 'FeatureCollection',
      features: [{ properties: { sol: 5021, lon: 137.3888471, lat: -4.82513971, dist_total_m: 38383.67 } }],
    };
    const p = parseWaypointFeed(feed, 'https://example.test/feed');
    expect(p).toMatchObject({
      sol: 5021,
      latDeg: -4.82513971,
      lonDeg: 137.3888471,
      distanceTotalM: 38383.67,
    });
    const west = parseWaypointFeed(
      { type: 'FeatureCollection', features: [{ properties: { sol: 1, lon: 354.5, lat: -2 } }] },
      'https://example.test/feed',
    );
    expect(west.lonDeg).toBeCloseTo(-5.5, 9);
  });

  it('rejects an unexpected payload', async () => {
    const { parseWaypointFeed } = await import('../pipeline/rovers');
    expect(() =>
      parseWaypointFeed({ type: 'FeatureCollection', features: [] }, 'https://example.test/feed'),
    ).toThrow();
  });
});

describe('Horizons window clamping', () => {
  const day = 86_400_000;
  const start = new Date('2026-08-01T00:00:00Z');
  const stop = new Date('2027-09-27T00:00:00Z');
  const span = stop.getTime() - start.getTime();

  it('truncates the end when coverage stops inside the window (now stays covered)', async () => {
    const { clampWindow } = await import('../pipeline/horizons');
    const limit = { kind: 'after' as const, date: new Date('2026-11-04T01:00:00Z') };
    const w = clampWindow(start, stop, limit, day, span);
    expect(w.start).toEqual(start);
    expect(w.stop.toISOString()).toBe('2026-11-03T01:00:00.000Z');
  });

  it('moves the whole window back when coverage ended before it', async () => {
    const { clampWindow } = await import('../pipeline/horizons');
    const limit = { kind: 'after' as const, date: new Date('2026-03-01T00:00:00Z') };
    const w = clampWindow(start, stop, limit, day, span);
    expect(w.stop.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(w.stop.getTime() - w.start.getTime()).toBe(span);
  });

  it('truncates the start when coverage begins inside the window', async () => {
    const { clampWindow } = await import('../pipeline/horizons');
    const limit = { kind: 'prior' as const, date: new Date('2026-09-01T00:00:00Z') };
    const w = clampWindow(start, stop, limit, day, span);
    expect(w.start.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    expect(w.stop).toEqual(stop);
  });
});

describe('moon ephemerides', () => {
  it('samples each moon about 64 times per orbit, between 10 min and a day', async () => {
    const { moonStepMin } = await import('../pipeline/horizons');
    expect(moonStepMin(0.3189)).toBe(10); // Phobos
    expect(moonStepMin(15.945)).toBe(359); // Titan
    expect(moonStepMin(546.19)).toBe(1440); // Phoebe
  });

  it('publishes moon tables in their own manifest section, and keeps a table that shrank', async () => {
    const { publishMoonEphemerides, readManifest } = await import('../pipeline/publish');
    const dir = await mkdtemp(join(tmpdir(), 'perigee-moons-'));
    const rows = (n: number): Float64Array => Float64Array.from({ length: n * 7 }, (_, i) => i);
    const write = (n: number) => ({
      moonId: 'titan',
      horizonsId: '606',
      center: '500@699',
      planet: 'saturn',
      stepMin: 359,
      source: 'test',
      fetchedAt: new Date('2026-10-08T00:00:00Z'),
      rows: rows(n),
      bytes: Buffer.from(rows(n).buffer),
    });
    await publishMoonEphemerides(dir, [write(100)]);
    let m = await readManifest(dir);
    expect(m.moons['titan']).toMatchObject({ path: 'ephem/moons/titan.bin', count: 100, planet: 'saturn' });
    expect(m.ephemerides).toEqual({});
    await publishMoonEphemerides(dir, [write(10)]);
    m = await readManifest(dir);
    expect(m.moons['titan']?.count).toBe(100);
  });
});
