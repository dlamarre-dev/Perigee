/**
 * Perigee's published data for the headless engine: the manifest, the Earth datasets and the ephemeris tables,
 * read from a Perigee site (https://perigee.info/ by default) with an injectable `fetch` and an optional byte
 * cache (the MCP server keeps one on disk, keyed by content hash). Never contacts CelesTrak or Horizons.
 *
 * Every file is checked against the SHA-256 the manifest (or a shard index) gives for it before it is used or
 * cached: GitHub Pages ignores `?v=` and caches for 10 minutes, so during an update a file of another version can
 * be served under the expected name. Only the latest version of each file stays in memory.
 */
import { EphemerisTable } from '../astro/hermite';
import { gunzipJson } from '../data/decode';
import { shardOf, shardPath } from '../data/shards';
import type { SatelliteStats } from '../earth/stats';
import {
  ManifestSchema,
  OmmListSchema,
  SatcatListSchema,
  ShardIndexSchema,
  type DatasetEntry,
  type Manifest,
  type Omm,
  type SatcatRecord,
  type ShardIndex,
} from '../data/schemas';

export type FetchLike = (
  url: string,
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Content-addressed bytes (key: path + hash): a hit is checked again, and dropped when it does not match. */
export interface ByteCache {
  get(key: string): Promise<ArrayBuffer | undefined>;
  set(key: string, bytes: ArrayBuffer): Promise<void>;
  delete?(key: string): Promise<void>;
}

export interface DataOptions {
  /** Site root (default https://perigee.info/); a missing final "/" is added. */
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
  readonly cache?: ByteCache;
  /** How long a manifest is reused before being read again (ms, default 10 min: data change every few hours). */
  readonly manifestTtlMs?: number;
}

/** gzip magic bytes: their absence on a .gz file means a server decoded it in transit (Content-Encoding). */
const isGzip = (bytes: Uint8Array): boolean => bytes[0] === 0x1f && bytes[1] === 0x8b;

async function gunzipText(bytes: Uint8Array): Promise<string> {
  if (!isGzip(bytes)) return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Lower-case hex SHA-256 (Web Crypto: browsers, Node 20+, Workers). */
export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
  }
}

/** A published file to read: its path and, when known, the SHA-256 it must have. */
interface FileRef {
  readonly path: string;
  /** Expected content hash; undefined for files published before hashes were (shards of older data). */
  readonly sha256: string | undefined;
  /** Cache key version (the expected hash, or the parent dataset's hash for unverified shards). */
  readonly version: string;
}

/** Keeps only the entries of `map` for the current version of a family of keys (`family@version…`). */
function prune<V>(map: Map<string, V>, family: string, version: string): void {
  for (const key of map.keys()) {
    if (key.startsWith(`${family}@`) && !key.startsWith(`${family}@${version}`)) map.delete(key);
  }
}

export class PublishedData {
  readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly cache: ByteCache | undefined;
  private readonly manifestTtlMs: number;
  private manifestValue: { at: number; manifest: Promise<Manifest> } | undefined;
  private readonly tables = new Map<string, Promise<EphemerisTable>>();
  private gp: { hash: string; data: Promise<readonly Omm[]> } | undefined;
  private satcat: { hash: string; data: Promise<readonly SatcatRecord[]> } | undefined;
  private readonly shardLists = new Map<string, Promise<readonly unknown[]>>();
  private readonly shardIndexes = new Map<string, Promise<ShardIndex>>();
  private statsValue: { hash: string; data: Promise<SatelliteStats> } | undefined;
  private namesValue: { key: string; text: Promise<{ raw: string; upper: string }> } | undefined;

  constructor(options: DataOptions = {}) {
    const base = options.baseUrl ?? 'https://perigee.info/';
    this.baseUrl = base.endsWith('/') ? base : `${base}/`;
    this.fetchFn = options.fetch ?? ((url) => fetch(url));
    this.cache = options.cache;
    this.manifestTtlMs = options.manifestTtlMs ?? 10 * 60_000;
  }

  private url(path: string): string {
    return `${this.baseUrl}data/${path}`;
  }

  /** The current manifest (re-read after the TTL, or at once after a file did not match it). */
  manifest(): Promise<Manifest> {
    const now = Date.now();
    if (!this.manifestValue || now - this.manifestValue.at > this.manifestTtlMs) {
      const manifest = this.download(this.url('manifest.json')).then(async (buf) =>
        ManifestSchema.parse(JSON.parse(new TextDecoder().decode(buf))),
      );
      // A failed read is not kept: the next call tries again.
      manifest.catch(() => {
        if (this.manifestValue?.manifest === manifest) this.manifestValue = undefined;
      });
      this.manifestValue = { at: now, manifest };
    }
    return this.manifestValue.manifest;
  }

  /** Numbers of parsed shard lists and tables in memory (tests: older versions must not pile up). */
  memoryEntries(): { shards: number; tables: number; shardIndexes: number } {
    return { shards: this.shardLists.size, tables: this.tables.size, shardIndexes: this.shardIndexes.size };
  }

  private async download(url: string): Promise<ArrayBuffer> {
    const res = await this.fetchFn(url);
    if (!res.ok) throw new DataError(`HTTP ${res.status} for ${url}`);
    return res.arrayBuffer();
  }

  /**
   * Bytes of a published file: from the cache when they still match, else downloaded, checked against the
   * expected hash and only then cached. A mismatch means the site is serving another version (an update in
   * progress): the manifest is read again next time and the caller gets an error rather than mixed data.
   */
  private async bytes(file: FileRef): Promise<ArrayBuffer> {
    const key = `${file.path}@${file.version.slice(0, 16)}`;
    const cached = await this.cache?.get(key);
    if (cached) {
      if (!file.sha256 || (await sha256Hex(cached)) === file.sha256) return cached;
      await this.cache?.delete?.(key);
    }
    const buf = await this.download(`${this.url(file.path)}?v=${file.version.slice(0, 12)}`);
    // A server that sends .gz files with Content-Encoding: gzip (Vite's dev and preview servers; not GitHub Pages)
    // hands over the decompressed bytes, whose hash cannot be checked: used as they are, never cached.
    if (file.path.endsWith('.gz') && !isGzip(new Uint8Array(buf))) return buf;
    if (file.sha256 && (await sha256Hex(buf)) !== file.sha256) {
      this.manifestValue = undefined;
      throw new DataError(
        `${file.path} does not match the published manifest: Perigee's data are being updated, try again in a few minutes`,
      );
    }
    await this.cache?.set(key, buf);
    return buf;
  }

  private entryFile(entry: Pick<DatasetEntry, 'path' | 'sha256'>): FileRef {
    return { path: entry.path, sha256: entry.sha256, version: entry.sha256 };
  }

  /** Active satellites' OMM elements (CelesTrak GP merged with SupGP), and the dataset entry (fetch time). */
  async gpElements(): Promise<{ entry: DatasetEntry; omm: readonly Omm[] }> {
    const entry = (await this.manifest()).datasets['earth.gp'];
    if (!entry) throw new DataError('The satellite elements are not published');
    if (this.gp?.hash !== entry.sha256) {
      const data = this.bytes(this.entryFile(entry)).then(async (buf) =>
        OmmListSchema.parse(await gunzipJson(new Uint8Array(buf))),
      );
      data.catch(() => (this.gp = undefined));
      this.gp = { hash: entry.sha256, data };
    }
    return { entry, omm: await this.gp.data };
  }

  /** SATCAT metadata of the active satellites (owner, launch, status), or undefined if unpublished. */
  async satcatRecords(): Promise<{ entry: DatasetEntry; records: readonly SatcatRecord[] } | undefined> {
    const entry = (await this.manifest()).datasets['earth.satcat'];
    if (!entry) return undefined;
    if (this.satcat?.hash !== entry.sha256) {
      const data = this.bytes(this.entryFile(entry)).then(async (buf) =>
        SatcatListSchema.parse(await gunzipJson(new Uint8Array(buf))),
      );
      data.catch(() => (this.satcat = undefined));
      this.satcat = { hash: entry.sha256, data };
    }
    return { entry, records: await this.satcat.data };
  }

  /** The hashes of a dataset's shards (pipeline index), checked against the manifest; undefined for older data. */
  private async shardIndex(
    entry: DatasetEntry,
    shards: NonNullable<DatasetEntry['shards']>,
  ): Promise<ShardIndex | undefined> {
    if (!shards.index) return undefined;
    const indexPath = shards.index;
    prune(this.shardIndexes, indexPath, entry.sha256);
    const key = `${indexPath}@${entry.sha256}`;
    let index = this.shardIndexes.get(key);
    if (!index) {
      index = this.bytes({ path: indexPath, sha256: shards.indexSha256, version: entry.sha256 }).then(
        async (buf) => {
          const parsed = ShardIndexSchema.parse(await gunzipJson(new Uint8Array(buf)));
          if (parsed.parent !== entry.sha256 || parsed.sha256.length !== shards.count) {
            this.manifestValue = undefined;
            throw new DataError(
              `${indexPath} belongs to another data version: Perigee's data are being updated, try again in a few minutes`,
            );
          }
          return parsed;
        },
      );
      index.catch(() => this.shardIndexes.delete(key));
      this.shardIndexes.set(key, index);
    }
    return index;
  }

  /**
   * Records of one shard of a sharded dataset (src/data/shards.ts), checked against the shard index: a request
   * about one satellite decodes a few dozen records instead of the whole file.
   */
  private async shard<T>(
    entry: DatasetEntry,
    shards: NonNullable<DatasetEntry['shards']>,
    norad: number,
    parse: (raw: unknown) => readonly T[],
  ): Promise<readonly T[]> {
    const k = shardOf(norad, shards.count);
    const path = shardPath(shards.path, k);
    prune(this.shardLists, shards.path, entry.sha256);
    const key = `${shards.path}@${entry.sha256}#${k}`;
    let list = this.shardLists.get(key);
    if (!list) {
      list = this.shardIndex(entry, shards)
        .then((index) =>
          this.bytes({ path, sha256: index?.sha256[k], version: index?.sha256[k] ?? entry.sha256 }),
        )
        .then(async (buf) => parse(await gunzipJson(new Uint8Array(buf))));
      list.catch(() => this.shardLists.delete(key));
      this.shardLists.set(key, list);
    }
    return list as Promise<readonly T[]>;
  }

  /** One active satellite's elements (undefined if not in the active set), from its shard when published. */
  async satelliteElements(norad: number): Promise<{ entry: DatasetEntry; omm: Omm | undefined }> {
    const entry = (await this.manifest()).datasets['earth.gp'];
    if (!entry) throw new DataError('The satellite elements are not published');
    const list = entry.shards
      ? await this.shard(entry, entry.shards, norad, (raw) => OmmListSchema.parse(raw))
      : (await this.gpElements()).omm;
    return { entry, omm: list.find((o) => o.NORAD_CAT_ID === norad) };
  }

  /** One satellite's SATCAT record, from its shard when published (undefined if unpublished or unknown). */
  async satcatRecord(norad: number): Promise<SatcatRecord | undefined> {
    const entry = (await this.manifest()).datasets['earth.satcat'];
    if (!entry) return undefined;
    const list = entry.shards
      ? await this.shard(entry, entry.shards, norad, (raw) => SatcatListSchema.parse(raw))
      : ((await this.satcatRecords())?.records ?? []);
    return list.find((r) => r.NORAD_CAT_ID === norad);
  }

  /**
   * Active satellites whose name contains the query, or whose NORAD or COSPAR id is it (case-insensitive), from
   * the name index when published (a text scan, no parsing), else from the whole elements file.
   */
  async searchSatellites(
    query: string,
    limit: number,
  ): Promise<{ norad: number; name: string; cospar: string }[]> {
    const q = query.trim().toUpperCase();
    const entry = (await this.manifest()).datasets['earth.gp'];
    if (!entry || !q) return [];
    const matches = (n: string, name: string, cospar: string): boolean =>
      name.toUpperCase().includes(q) || n === q || cospar.toUpperCase() === q;
    const out: { norad: number; name: string; cospar: string }[] = [];
    if (!entry.names) {
      for (const o of (await this.gpElements()).omm) {
        if (out.length >= limit) break;
        if (matches(String(o.NORAD_CAT_ID), o.OBJECT_NAME, o.OBJECT_ID))
          out.push({ norad: o.NORAD_CAT_ID, name: o.OBJECT_NAME, cospar: o.OBJECT_ID });
      }
      return out;
    }
    const key = `${entry.names}@${entry.sha256}`;
    if (this.namesValue?.key !== key) {
      const file: FileRef = {
        path: entry.names,
        sha256: entry.namesSha256,
        version: entry.namesSha256 ?? entry.sha256,
      };
      const text = this.bytes(file).then(async (buf) => {
        const raw = await gunzipText(new Uint8Array(buf));
        return { raw, upper: raw.toUpperCase() };
      });
      text.catch(() => (this.namesValue = undefined));
      this.namesValue = { key, text };
    }
    const { raw, upper } = await this.namesValue.text;
    for (let i = upper.indexOf(q); i >= 0 && out.length < limit; i = upper.indexOf(q, i)) {
      const start = upper.lastIndexOf('\n', i) + 1;
      let end = upper.indexOf('\n', i);
      if (end < 0) end = upper.length;
      const [n = '', name = '', cospar = ''] = raw.slice(start, end).split('\t');
      if (matches(n, name, cospar)) out.push({ norad: Number(n), name, cospar });
      i = end;
    }
    return out;
  }

  /** Counts of the active catalogue written by the pipeline (src/earth/stats.ts), or undefined if unpublished. */
  async stats(): Promise<{ entry: NonNullable<Manifest['stats']>; stats: SatelliteStats } | undefined> {
    const entry = (await this.manifest()).stats;
    if (!entry) return undefined;
    if (this.statsValue?.hash !== entry.sha256) {
      const data = this.bytes(this.entryFile(entry)).then(
        async (buf) => (await gunzipJson(new Uint8Array(buf))) as SatelliteStats,
      );
      data.catch(() => (this.statsValue = undefined));
      this.statsValue = { hash: entry.sha256, data };
    }
    const stats = await this.statsValue.data;
    if (stats.version !== 1) throw new DataError('Unknown statistics format');
    return { entry, stats };
  }

  /** A state-vector table (mission or moon), keyed by its content hash; older versions are dropped. */
  table(entry: Pick<DatasetEntry, 'path' | 'sha256' | 'bytes'>): Promise<EphemerisTable> {
    prune(this.tables, entry.path, entry.sha256);
    const key = `${entry.path}@${entry.sha256}`;
    let t = this.tables.get(key);
    if (!t) {
      t = this.bytes(this.entryFile(entry)).then((buf) => {
        if (buf.byteLength !== entry.bytes) throw new DataError(`Size mismatch for ${entry.path}`);
        const view = new DataView(buf);
        const rows = new Float64Array(buf.byteLength / 8);
        for (let i = 0; i < rows.length; i++) rows[i] = view.getFloat64(i * 8, true);
        return new EphemerisTable(rows);
      });
      t.catch(() => this.tables.delete(key));
      this.tables.set(key, t);
    }
    return t;
  }
}
