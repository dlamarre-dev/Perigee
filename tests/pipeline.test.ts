import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ManifestSchema } from '../src/data/schemas';
import { publishDatasets, readManifest, ShrinkGuardError } from '../pipeline/publish';

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
