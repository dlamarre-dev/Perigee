/**
 * Writes validated datasets into the data directory and updates manifest.json.
 * Guard: a dataset smaller than 50 % of the previously published one is refused (the previous file stays).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  GroupsSchema,
  ManifestSchema,
  OmmListSchema,
  SatcatListSchema,
  type DatasetKey,
  type EphemerisEntry,
  type Manifest,
  type OperatorsCatalog,
} from '../src/data/schemas';
import { buildCatalog } from '../src/earth/catalog';
import { satelliteStats } from '../src/earth/stats';
import { SHARD_COUNT, shardOf, shardPath } from '../src/data/shards';

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
    return { version: 1, generatedAt: new Date(0).toISOString(), datasets: {}, ephemerides: {}, moons: {} };
  return ManifestSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

export interface DatasetToWrite {
  readonly key: DatasetKey;
  readonly path: string;
  readonly source: string;
  readonly fetchedAt: Date;
  readonly count: number;
  readonly payload: unknown;
  /** Split copies of an array payload by NORAD number, for the machine interfaces (src/data/shards.ts). */
  readonly shards?: { readonly path: string; readonly norad: (record: never) => number };
  /** Text index written next to the dataset (earth.gp names). */
  readonly names?: { readonly path: string; readonly text: string };
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
    if (d.shards) await writeShards(dataDir, d.shards.path, d.payload as never[], d.shards.norad);
    if (d.names) {
      const namesFile = join(dataDir, d.names.path);
      await mkdir(dirname(namesFile), { recursive: true });
      await writeFile(namesFile, gzipSync(Buffer.from(d.names.text), { level: 9 }));
    }
    next.datasets[d.key] = {
      path: d.path,
      source: d.source,
      fetchedAt: d.fetchedAt.toISOString(),
      count: d.count,
      bytes: gz.byteLength,
      sha256: createHash('sha256').update(gz).digest('hex'),
      ...(d.shards ? { shards: { count: SHARD_COUNT, path: d.shards.path } } : {}),
      ...(d.names ? { names: d.names.path } : {}),
    };
    console.log(`wrote ${d.path}: ${d.count} records, ${(gz.byteLength / 1024).toFixed(0)} KiB`);
  }
  next.generatedAt = new Date().toISOString();
  ManifestSchema.parse(next);
  await writeFile(join(dataDir, 'manifest.json'), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * Counts of the active catalogue for the machine interfaces (src/earth/stats.ts), from the published elements,
 * SATCAT and groups: data/earth/stats.json.gz and the manifest's `stats` field. Skipped while the elements are
 * missing.
 */
export async function writeStats(dataDir: string, operators: OperatorsCatalog): Promise<void> {
  const manifest = await readManifest(dataDir);
  const gpEntry = manifest.datasets['earth.gp'];
  if (!gpEntry) return;
  const read = async (path: string | undefined): Promise<unknown> =>
    path && existsSync(join(dataDir, path))
      ? JSON.parse(gunzipSync(await readFile(join(dataDir, path))).toString('utf8'))
      : undefined;
  const gp = OmmListSchema.parse(await read(gpEntry.path));
  const satcatRaw = await read(manifest.datasets['earth.satcat']?.path);
  const groupsRaw = await read(manifest.datasets['earth.groups']?.path);
  const catalog = buildCatalog(
    gp,
    satcatRaw ? SatcatListSchema.parse(satcatRaw) : undefined,
    groupsRaw ? GroupsSchema.parse(groupsRaw) : undefined,
    operators,
  );
  const stats = satelliteStats(catalog, Date.parse(gpEntry.fetchedAt));
  const gz = gzipSync(Buffer.from(JSON.stringify(stats)), { level: 9 });
  const path = 'earth/stats.json.gz';
  await writeFile(join(dataDir, path), gz);
  const satcatFetchedAt = manifest.datasets['earth.satcat']?.fetchedAt;
  const next: Manifest = {
    ...manifest,
    stats: {
      path,
      bytes: gz.byteLength,
      sha256: createHash('sha256').update(gz).digest('hex'),
      generatedAt: new Date().toISOString(),
      gpFetchedAt: gpEntry.fetchedAt,
      ...(satcatFetchedAt ? { satcatFetchedAt } : {}),
    },
  };
  ManifestSchema.parse(next);
  await writeFile(join(dataDir, 'manifest.json'), `${JSON.stringify(next, null, 2)}\n`);
  console.log(`wrote ${path}: ${stats.total} satellites counted`);
}

/** Writes the SHARD_COUNT split copies of a record list (every shard, empty ones included). */
async function writeShards(
  dataDir: string,
  template: string,
  records: readonly never[],
  norad: (record: never) => number,
): Promise<void> {
  const shards: never[][] = Array.from({ length: SHARD_COUNT }, () => []);
  for (const r of records) shards[shardOf(norad(r), SHARD_COUNT)]?.push(r);
  for (const [i, list] of shards.entries()) {
    const file = join(dataDir, shardPath(template, i));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, gzipSync(Buffer.from(JSON.stringify(list)), { level: 9 }));
  }
}

/** Records which CelesTrak supplemental GP sets fed the last earth.gp (manifest `supplemental`). */
export async function writeSupplementalInfo(
  dataDir: string,
  info: NonNullable<Manifest['supplemental']>,
): Promise<void> {
  const manifest = await readManifest(dataDir);
  const next: Manifest = { ...manifest, supplemental: info };
  ManifestSchema.parse(next);
  await writeFile(join(dataDir, 'manifest.json'), `${JSON.stringify(next, null, 2)}\n`);
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
 * then the refused ones are reported (ShrinkGuardError) so the run fails (an issue after two in a row). Missions
 * not listed keep their previously published file.
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

export interface MoonEphemerisToWrite {
  readonly moonId: string;
  readonly horizonsId: string;
  readonly center: string;
  readonly planet: string;
  readonly stepMin: number;
  readonly source: string;
  readonly fetchedAt: Date;
  /** Rows of 7 Float64: t_TDB JD, x, y, z, vx, vy, vz (planet-relative, km, km/s). */
  readonly rows: Float64Array;
  readonly bytes: Buffer;
}

/**
 * Writes data/ephem/moons/<id>.bin and the manifest's `moons` entries. Same guard as the missions (an empty
 * table, or below half the previous one without a coarser step, keeps the previous file), but refusals only
 * warn: moons have a fallback (mean elements), and the weekly audit flags those not refreshed.
 */
export async function publishMoonEphemerides(
  dataDir: string,
  list: readonly MoonEphemerisToWrite[],
): Promise<Manifest> {
  const manifest = await readManifest(dataDir);
  const next: Manifest = { ...manifest, moons: { ...manifest.moons } };
  for (const m of list) {
    const count = m.rows.length / 7;
    const prev = manifest.moons[m.moonId];
    if (count === 0 || (prev && count < prev.count * MIN_RATIO_VS_PREVIOUS && !(m.stepMin > prev.stepMin))) {
      console.warn(
        `moon ${m.moonId}: ${count} states is below half of the previous ${prev?.count ?? 0}; kept`,
      );
      continue;
    }
    const path = `ephem/moons/${m.moonId}.bin`;
    const file = join(dataDir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, m.bytes);
    next.moons[m.moonId] = {
      path,
      source: m.source,
      fetchedAt: m.fetchedAt.toISOString(),
      count,
      bytes: m.bytes.byteLength,
      sha256: createHash('sha256').update(m.bytes).digest('hex'),
      horizonsId: m.horizonsId,
      center: m.center,
      planet: m.planet,
      startTdbJd: m.rows[0] ?? 0,
      endTdbJd: m.rows[m.rows.length - 7] ?? 0,
      stepMin: m.stepMin,
    };
    console.log(`wrote ${path}: ${count} states, ${(m.bytes.byteLength / 1024).toFixed(0)} KiB`);
  }
  next.generatedAt = new Date().toISOString();
  ManifestSchema.parse(next);
  await writeFile(join(dataDir, 'manifest.json'), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
