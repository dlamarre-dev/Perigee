/**
 * Writes validated datasets into the data directory and updates manifest.json.
 * Guard: a dataset smaller than 50 % of the previously published one is refused (the previous file stays).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ManifestSchema, type DatasetKey, type Manifest } from '../src/data/schemas';

export const MIN_RATIO_VS_PREVIOUS = 0.5;

export class ShrinkGuardError extends Error {
  constructor(key: DatasetKey, count: number, previous: number) {
    super(`${key}: ${count} records is below ${MIN_RATIO_VS_PREVIOUS * 100} % of the previous ${previous}`);
    this.name = 'ShrinkGuardError';
  }
}

export async function readManifest(dataDir: string): Promise<Manifest> {
  const file = join(dataDir, 'manifest.json');
  if (!existsSync(file)) return { version: 1, generatedAt: new Date(0).toISOString(), datasets: {} };
  return ManifestSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

export interface DatasetToWrite {
  readonly key: DatasetKey;
  readonly path: string;
  readonly source: string;
  readonly fetchedAt: Date;
  readonly count: number;
  readonly payload: unknown;
}

/** Checks every dataset against the guard first, then writes all of them or none. */
export async function publishDatasets(
  dataDir: string,
  datasets: readonly DatasetToWrite[],
): Promise<Manifest> {
  const manifest = await readManifest(dataDir);
  for (const d of datasets) {
    const previous = manifest.datasets[d.key]?.count ?? 0;
    if (d.count === 0 || d.count < previous * MIN_RATIO_VS_PREVIOUS) {
      throw new ShrinkGuardError(d.key, d.count, previous);
    }
  }

  const next: Manifest = { ...manifest, datasets: { ...manifest.datasets } };
  for (const d of datasets) {
    const gz = gzipSync(Buffer.from(JSON.stringify(d.payload)), { level: 9 });
    const file = join(dataDir, d.path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, gz);
    next.datasets[d.key] = {
      path: d.path,
      source: d.source,
      fetchedAt: d.fetchedAt.toISOString(),
      count: d.count,
      bytes: gz.byteLength,
      sha256: createHash('sha256').update(gz).digest('hex'),
    };
    console.log(`wrote ${d.path}: ${d.count} records, ${(gz.byteLength / 1024).toFixed(0)} KiB`);
  }
  next.generatedAt = new Date().toISOString();
  ManifestSchema.parse(next);
  await writeFile(join(dataDir, 'manifest.json'), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
