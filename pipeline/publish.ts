/**
 * Writes validated datasets into the data directory and updates manifest.json.
 * Guard: a dataset smaller than 50 % of the previously published one is refused (the previous file stays).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
import { utcToTdbJd } from '../src/astro/time';
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
    const datasetSha256 = sha256(gz);
    const shardIndex = d.shards
      ? await writeShards(dataDir, d.shards.path, d.payload as never[], d.shards.norad, datasetSha256)
      : undefined;
    let namesSha256: string | undefined;
    if (d.names) {
      const namesFile = join(dataDir, d.names.path);
      await mkdir(dirname(namesFile), { recursive: true });
      const namesGz = gzipSync(Buffer.from(d.names.text), { level: 9 });
      await writeFile(namesFile, namesGz);
      namesSha256 = sha256(namesGz);
    }
    next.datasets[d.key] = {
      path: d.path,
      source: d.source,
      fetchedAt: d.fetchedAt.toISOString(),
      count: d.count,
      bytes: gz.byteLength,
      sha256: datasetSha256,
      ...(d.shards && shardIndex
        ? { shards: { count: SHARD_COUNT, path: d.shards.path, ...shardIndex } }
        : {}),
      ...(d.names && namesSha256 ? { names: d.names.path, namesSha256 } : {}),
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

/** Days of daily earth.gp copies kept (manifest `earthHistory`). */
export const EARTH_HISTORY_DAYS = 30;

/**
 * Keeps the outgoing earth.gp as the copy of its UTC day, before a run of a later day replaces it: the last GP run
 * of each day, with its shards (the engine reads one shard) — copied, not fetched again. Copies older than
 * EARTH_HISTORY_DAYS are deleted. Updates the manifest's `earthHistory`; the dataset publication that follows keeps
 * the field.
 */
export async function archiveGpSnapshot(dataDir: string, now: Date): Promise<void> {
  const manifest = await readManifest(dataDir);
  const entry = manifest.datasets['earth.gp'];
  const today = now.toISOString().slice(0, 10);
  let snapshots = [...(manifest.earthHistory?.snapshots ?? [])];
  const day = entry?.fetchedAt.slice(0, 10);
  if (
    entry &&
    day &&
    day < today &&
    !snapshots.some((s) => s.date === day) &&
    existsSync(join(dataDir, entry.path))
  ) {
    const path = `earth/history/${day}.json.gz`;
    await mkdir(dirname(join(dataDir, path)), { recursive: true });
    await copyFile(join(dataDir, entry.path), join(dataDir, path));
    let shards: (typeof snapshots)[number]['shards'];
    const s = entry.shards;
    // The shards go along when published with their index (a local `data:pull` copy has neither).
    if (s?.index && s.indexSha256 && existsSync(join(dataDir, s.index))) {
      const template = `earth/history/${day}/{shard}.json.gz`;
      await mkdir(join(dataDir, `earth/history/${day}`), { recursive: true });
      for (let i = 0; i < s.count; i++) {
        const from = join(dataDir, shardPath(s.path, i));
        if (existsSync(from)) await copyFile(from, join(dataDir, shardPath(template, i)));
      }
      await copyFile(join(dataDir, s.index), join(dataDir, shardPath(template, 'index')));
      shards = {
        count: s.count,
        path: template,
        index: shardPath(template, 'index'),
        indexSha256: s.indexSha256,
      };
    }
    snapshots.push({
      date: day,
      path,
      fetchedAt: entry.fetchedAt,
      count: entry.count,
      bytes: entry.bytes,
      sha256: entry.sha256,
      ...(shards ? { shards } : {}),
    });
    console.log(`kept ${path}: the last earth.gp of ${day}`);
  }
  // Only the last EARTH_HISTORY_DAYS days.
  const oldest = new Date(now.getTime() - EARTH_HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const old of snapshots.filter((x) => x.date < oldest)) {
    await rm(join(dataDir, old.path), { force: true });
    await rm(join(dataDir, `earth/history/${old.date}`), { recursive: true, force: true });
  }
  snapshots = snapshots.filter((x) => x.date >= oldest).sort((a, b) => a.date.localeCompare(b.date));
  const next: Manifest = {
    ...manifest,
    ...(snapshots.length > 0 ? { earthHistory: { days: EARTH_HISTORY_DAYS, snapshots } } : {}),
  };
  if (snapshots.length === 0) delete next.earthHistory;
  ManifestSchema.parse(next);
  await writeFile(join(dataDir, 'manifest.json'), `${JSON.stringify(next, null, 2)}\n`);
}

/** Writes the SHARD_COUNT split copies of a record list (every shard, empty ones included). */
async function writeShards(
  dataDir: string,
  template: string,
  records: readonly never[],
  norad: (record: never) => number,
  parent: string,
): Promise<{ index: string; indexSha256: string }> {
  const shards: never[][] = Array.from({ length: SHARD_COUNT }, () => []);
  for (const r of records) shards[shardOf(norad(r), SHARD_COUNT)]?.push(r);
  const hashes: string[] = [];
  for (const [i, list] of shards.entries()) {
    const file = join(dataDir, shardPath(template, i));
    await mkdir(dirname(file), { recursive: true });
    const gz = gzipSync(Buffer.from(JSON.stringify(list)), { level: 9 });
    await writeFile(file, gz);
    hashes.push(sha256(gz));
  }
  // The shards' hashes, tied to their dataset version: readers check each shard (src/engine/data.ts).
  const index = shardPath(template, 'index');
  const gz = gzipSync(Buffer.from(JSON.stringify({ parent, sha256: hashes })), { level: 9 });
  await writeFile(join(dataDir, index), gz);
  return { index, indexSha256: sha256(gz) };
}

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

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
  /** One-time fill of the archive (`--bootstrap-past`): Horizons rows from 30 days ago to the window start. */
  readonly pastRows?: Float64Array;
}

/** Days of states kept before the window (ephem/past/<id>.bin). */
export const PAST_DAYS = 30;
const ROW = 7;

/** Rows of a published .bin (7 little-endian Float64 each). */
export function readRows(bytes: Buffer): Float64Array {
  const out = new Float64Array(Math.floor(bytes.byteLength / 8));
  for (let i = 0; i < out.length; i++) out[i] = bytes.readDoubleLE(i * 8);
  return out;
}

/**
 * The archive of states before a new window: rows earlier than `newStartJd` and not older than `cutoffJd`, from
 * sources listed oldest first (the previous archive, the previous window, a one-time Horizons fill). A later
 * source owns its own time span: earlier sources' rows inside it are dropped, so two step grids never interleave
 * (a missed run is filled by the previous window's rows, which Horizons published then).
 */
export function mergePast(
  sources: readonly (Float64Array | undefined)[],
  newStartJd: number,
  cutoffJd: number,
): Float64Array {
  const kept: { t: number; source: number; offset: number }[] = [];
  const spans = sources.map((rows) =>
    rows && rows.length >= ROW ? ([rows[0] ?? 0, rows[rows.length - ROW] ?? 0] as const) : undefined,
  );
  sources.forEach((rows, source) => {
    if (!rows) return;
    for (let o = 0; o + ROW <= rows.length; o += ROW) {
      const t = rows[o] ?? Number.NaN;
      if (!(t >= cutoffJd && t < newStartJd)) continue;
      const owned = spans.some((span, later) => later > source && span && t >= span[0] && t <= span[1]);
      if (!owned) kept.push({ t, source, offset: o });
    }
  });
  kept.sort((a, b) => a.t - b.t);
  const out: number[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const k of kept) {
    if (k.t <= last) continue;
    const rows = sources[k.source];
    if (!rows) continue;
    const row = Array.from(rows.subarray(k.offset, k.offset + ROW));
    if (!row.every(Number.isFinite)) continue;
    out.push(...row);
    last = k.t;
  }
  return Float64Array.from(out);
}

/** Largest interval between rows (minutes), the archive's coarsest step. */
function largestStepMin(rows: Float64Array): number {
  let max = 0;
  for (let o = ROW; o < rows.length; o += ROW) max = Math.max(max, (rows[o] ?? 0) - (rows[o - ROW] ?? 0));
  return Math.max(max * 1440, 1e-6);
}

async function readBin(dataDir: string, path: string | undefined): Promise<Float64Array | undefined> {
  if (!path) return undefined;
  const file = join(dataDir, path);
  if (!existsSync(file)) return undefined;
  return readRows(await readFile(file));
}

/**
 * Writes data/ephem/past/<id>.bin for a mission whose new window starts less than PAST_DAYS ago (heliocentric
 * windows already reach 60 days back), and returns its manifest field; undefined when there is nothing to keep.
 * Missions not fetched this run keep their entry (and archive) as is.
 */
async function publishPast(
  dataDir: string,
  e: EphemerisToWrite,
  prev: EphemerisEntry | undefined,
  now: Date,
): Promise<EphemerisEntry['past']> {
  const newStartJd = e.rows[0] ?? 0;
  const cutoffJd = utcToTdbJd(new Date(now.getTime() - PAST_DAYS * 86_400_000));
  const path = `ephem/past/${e.missionId}.bin`;
  const file = join(dataDir, path);
  const rows =
    newStartJd <= cutoffJd
      ? new Float64Array(0)
      : mergePast(
          [await readBin(dataDir, prev?.past?.path), await readBin(dataDir, prev?.path), e.pastRows],
          newStartJd,
          cutoffJd,
        );
  if (rows.length === 0) {
    // Nothing left to keep (the window reaches back far enough, or every row is older than 30 days).
    await rm(file, { force: true });
    return undefined;
  }
  await mkdir(dirname(file), { recursive: true });
  const bytes = Buffer.alloc(rows.length * 8);
  for (let i = 0; i < rows.length; i++) bytes.writeDoubleLE(rows[i] ?? 0, i * 8);
  await writeFile(file, bytes);
  const count = rows.length / ROW;
  console.log(`wrote ${path}: ${count} archived states, ${(bytes.byteLength / 1024).toFixed(0)} KiB`);
  return {
    path,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    count,
    startTdbJd: rows[0] ?? 0,
    endTdbJd: rows[rows.length - ROW] ?? 0,
    stepMin: largestStepMin(rows),
  };
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
  now: Date = new Date(),
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
    // The archive first: it reads the previous window's file, about to be replaced.
    const past = await publishPast(dataDir, e, manifest.ephemerides[e.missionId], now);
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
      ...(past ? { past } : {}),
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
