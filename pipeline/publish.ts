/**
 * Writes validated datasets into the data directory and updates manifest.json.
 * Guard: a dataset smaller than 50 % of the previously published one is refused (the previous file stays).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ManifestSchema, type DatasetKey, type EphemerisEntry, type Manifest } from '../src/data/schemas';

export const MIN_RATIO_VS_PREVIOUS = 0.5;

export class ShrinkGuardError extends Error {
  constructor(key: string, count: number, previous: number) {
    super(`${key}: ${count} records is below ${MIN_RATIO_VS_PREVIOUS * 100} % of the previous ${previous}`);
    this.name = 'ShrinkGuardError';
  }
}

export async function readManifest(dataDir: string): Promise<Manifest> {
  const file = join(dataDir, 'manifest.json');
  if (!existsSync(file))
    return { version: 1, generatedAt: new Date(0).toISOString(), datasets: {}, ephemerides: {} };
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

export interface EphemerisToWrite {
  readonly missionId: string;
  readonly horizonsId: string;
  readonly center: string;
  readonly centralBody: EphemerisEntry['centralBody'];
  readonly stepMin: number;
  readonly source: string;
  readonly fetchedAt: Date;
  /** Rows of 7 Float64: t_TDB JD, x, y, z, vx, vy, vz. */
  readonly rows: Float64Array;
  /** Little-endian bytes of `rows`. */
  readonly bytes: Buffer;
  /** End of the public ephemeris, when Horizons reported it inside the window. */
  readonly coverageEnd?: Date;
}

/**
 * Writes data/ephem/<mission>.bin files and their manifest entries. Guard per mission: an empty table, or one
 * below half the previous size without an explanation (a coverage end reported by Horizons now truncating the
 * window, or a coarser sampling step), keeps that mission's previous file; the others are still published,
 * then the refused ones are reported (ShrinkGuardError) so the run fails and opens an issue. Missions not listed
 * keep their previously published file.
 */
export async function publishEphemerides(
  dataDir: string,
  list: readonly EphemerisToWrite[],
): Promise<Manifest> {
  const manifest = await readManifest(dataDir);
  const refused: ShrinkGuardError[] = [];
  const accepted = list.filter((e) => {
    const count = e.rows.length / 7;
    const prev = manifest.ephemerides[e.missionId];
    const previous = prev?.count ?? 0;
    const explained =
      prev !== undefined &&
      ((e.coverageEnd !== undefined && e.coverageEnd.toISOString() !== prev.coverageEnd) ||
        e.stepMin > prev.stepMin);
    if (count === 0 || (count < previous * MIN_RATIO_VS_PREVIOUS && !explained)) {
      refused.push(new ShrinkGuardError(`ephem.${e.missionId}`, count, previous));
      return false;
    }
    return true;
  });
  const next: Manifest = { ...manifest, ephemerides: { ...manifest.ephemerides } };
  for (const e of accepted) {
    const path = `ephem/${e.missionId}.bin`;
    const file = join(dataDir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, e.bytes);
    const count = e.rows.length / 7;
    next.ephemerides[e.missionId] = {
      path,
      source: e.source,
      fetchedAt: e.fetchedAt.toISOString(),
      count,
      bytes: e.bytes.byteLength,
      sha256: createHash('sha256').update(e.bytes).digest('hex'),
      horizonsId: e.horizonsId,
      center: e.center,
      centralBody: e.centralBody,
      startTdbJd: e.rows[0] ?? 0,
      endTdbJd: e.rows[e.rows.length - 7] ?? 0,
      stepMin: e.stepMin,
      ...(e.coverageEnd ? { coverageEnd: e.coverageEnd.toISOString() } : {}),
    };
    console.log(`wrote ${path}: ${count} states, ${(e.bytes.byteLength / 1024).toFixed(0)} KiB`);
  }
  next.generatedAt = new Date().toISOString();
  ManifestSchema.parse(next);
  await writeFile(join(dataDir, 'manifest.json'), `${JSON.stringify(next, null, 2)}\n`);
  if (refused.length > 0) throw new AggregateShrinkError(refused);
  return next;
}

/** Ephemerides refused by the shrink guard (the others were published). */
export class AggregateShrinkError extends Error {
  constructor(readonly errors: readonly ShrinkGuardError[]) {
    super(errors.map((e) => e.message).join('; '));
    this.name = 'ShrinkGuardError';
  }
}
