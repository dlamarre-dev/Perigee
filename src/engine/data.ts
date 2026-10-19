/**
 * Perigee's published data for the headless engine: the manifest, the Earth datasets and the ephemeris tables,
 * read from a Perigee site (https://perigee.info/ by default) with an injectable `fetch` and an optional byte
 * cache (the MCP server keeps one on disk, keyed by content hash). Never contacts CelesTrak or Horizons.
 */
import { EphemerisTable } from '../astro/hermite';
import { gunzipJson } from '../data/decode';
import { shardOf, shardPath } from '../data/shards';
import {
  ManifestSchema,
  OmmListSchema,
  SatcatListSchema,
  type DatasetEntry,
  type Manifest,
  type Omm,
  type SatcatRecord,
} from '../data/schemas';

export type FetchLike = (
  url: string,
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Content-addressed bytes (key: path + hash): a hit never needs revalidation. */
export interface ByteCache {
  get(key: string): Promise<ArrayBuffer | undefined>;
  set(key: string, bytes: ArrayBuffer): Promise<void>;
}

export interface DataOptions {
  /** Site root, ending with "/" (default https://perigee.info/). */
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
  readonly cache?: ByteCache;
  /** How long a manifest is reused before being read again (ms, default 10 min: data change every few hours). */
  readonly manifestTtlMs?: number;
}

async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
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
  private namesValue: { key: string; text: Promise<{ raw: string; upper: string }> } | undefined;

  constructor(options: DataOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://perigee.info/';
    this.fetchFn = options.fetch ?? ((url) => fetch(url));
    this.cache = options.cache;
    this.manifestTtlMs = options.manifestTtlMs ?? 10 * 60_000;
  }

  private url(path: string): string {
    return `${this.baseUrl}data/${path}`;
  }

  /** The current manifest (re-read after the TTL). */
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

  private async download(url: string): Promise<ArrayBuffer> {
    const res = await this.fetchFn(url);
    if (!res.ok) throw new DataError(`HTTP ${res.status} for ${url}`);
    return res.arrayBuffer();
  }

  /** Bytes of a published file, from the cache when its hash is known there. */
  private async bytes(entry: Pick<DatasetEntry, 'path' | 'sha256'>): Promise<ArrayBuffer> {
    const key = `${entry.path}@${entry.sha256.slice(0, 16)}`;
    const cached = await this.cache?.get(key);
    if (cached) return cached;
    const buf = await this.download(`${this.url(entry.path)}?v=${entry.sha256.slice(0, 12)}`);
    await this.cache?.set(key, buf);
    return buf;
  }

  /** Active satellites' OMM elements (CelesTrak GP merged with SupGP), and the dataset entry (fetch time). */
  async gpElements(): Promise<{ entry: DatasetEntry; omm: readonly Omm[] }> {
    const entry = (await this.manifest()).datasets['earth.gp'];
    if (!entry) throw new DataError('The satellite elements are not published');
    if (this.gp?.hash !== entry.sha256) {
      const data = this.bytes(entry).then(async (buf) =>
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
      const data = this.bytes(entry).then(async (buf) =>
        SatcatListSchema.parse(await gunzipJson(new Uint8Array(buf))),
      );
      data.catch(() => (this.satcat = undefined));
      this.satcat = { hash: entry.sha256, data };
    }
    return { entry, records: await this.satcat.data };
  }

  /**
   * Records of one shard of a sharded dataset (src/data/shards.ts), cached by content hash: a request about one
   * satellite decodes a few dozen records instead of the whole file.
   */
  private shard<T>(
    entry: DatasetEntry,
    shards: NonNullable<DatasetEntry['shards']>,
    norad: number,
    parse: (raw: unknown) => readonly T[],
  ): Promise<readonly T[]> {
    const path = shardPath(shards.path, shardOf(norad, shards.count));
    const key = `${path}@${entry.sha256}`;
    let list = this.shardLists.get(key);
    if (!list) {
      list = this.bytes({ path, sha256: entry.sha256 }).then(async (buf) =>
        parse(await gunzipJson(new Uint8Array(buf))),
      );
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
      const text = this.bytes({ path: entry.names, sha256: entry.sha256 }).then(async (buf) => {
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

  /** A state-vector table (mission or moon), keyed by its content hash. */
  table(entry: Pick<DatasetEntry, 'path' | 'sha256' | 'bytes'>): Promise<EphemerisTable> {
    const key = `${entry.path}@${entry.sha256}`;
    let t = this.tables.get(key);
    if (!t) {
      t = this.bytes(entry).then((buf) => {
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
