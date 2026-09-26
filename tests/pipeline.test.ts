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
