/**
 * Perigee's published data for the headless engine: the manifest, the Earth datasets and the ephemeris tables,
 * read from a Perigee site (https://perigee.info/ by default) with an injectable `fetch` and an optional byte
 * cache (the MCP server keeps one on disk, keyed by content hash). Never contacts CelesTrak or Horizons.
 */
import { EphemerisTable } from '../astro/hermite';
import { gunzipJson } from '../data/decode';
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
