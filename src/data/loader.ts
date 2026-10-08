/**
 * Client-side data loading. Reads `data/manifest.json` first, then gzip-compressed datasets from the same
 * origin (published from the `data` branch). Never contacts upstream providers.
 */
import type { z } from 'zod';
import { EphemerisTable } from '../astro/hermite';
import { BULK_SCHEMAS, gunzipJson, type BulkSchemaName } from './decode';
import {
  ManifestSchema,
  type DatasetEntry,
  type DatasetKey,
  type EphemerisEntry,
  type Manifest,
} from './schemas';

export class DataUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataUnavailableError';
  }
}

export function dataRoot(baseUrl: string): string {
  return `${baseUrl}data/`;
}

export async function loadManifest(baseUrl: string): Promise<Manifest> {
  const url = `${dataRoot(baseUrl)}manifest.json`;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new DataUnavailableError(`HTTP ${res.status} for ${url}`);
  return ManifestSchema.parse(await res.json());
}

export async function loadDataset<S extends z.ZodType>(
  baseUrl: string,
  manifest: Manifest,
  key: DatasetKey,
  schema: S,
): Promise<{ entry: DatasetEntry; data: z.infer<S> }> {
  const entry = manifest.datasets[key];
  if (!entry) throw new DataUnavailableError(`Dataset ${key} is not published`);
  // The hash in the query string busts caches whenever the content changes.
  const url = `${dataRoot(baseUrl)}${entry.path}?v=${entry.sha256.slice(0, 12)}`;
  const res = await fetch(url);
  if (!res.ok) throw new DataUnavailableError(`HTTP ${res.status} for ${url}`);
  return { entry, data: schema.parse(await gunzipJson(new Uint8Array(await res.arrayBuffer()))) };
}

let decoder: Worker | undefined | null;
let nextId = 0;
const pending = new Map<number, { resolve: (data: unknown) => void; reject: (err: Error) => void }>();

/** The decode worker itself failed (not the data): the caller decodes on the main thread instead. */
class DecodeWorkerError extends Error {}

/**
 * The shared decode worker, or undefined where module workers are unavailable or the worker has failed (its
 * chunk missing after a deployment, module workers unsupported): it is then never used again.
 */
function decodeWorker(): Worker | undefined {
  if (decoder !== undefined) return decoder ?? undefined;
  try {
    const worker = new Worker(new URL('./decode.worker.ts', import.meta.url), {
      type: 'module',
      name: 'decode',
    });
    worker.onmessage = (e: MessageEvent<{ id: number; data?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (e.data.error !== undefined) p?.reject(new DataUnavailableError(e.data.error));
      else p?.resolve(e.data.data);
    };
    // A load failure usually fires before any request is pending: forget the worker so later calls (and the
    // one waiting for its download) decode on the main thread rather than wait for an answer that never comes.
    worker.onerror = () => {
      if (decoder === worker) decoder = null;
      for (const p of pending.values()) p.reject(new DecodeWorkerError('decode worker failed'));
      pending.clear();
    };
    decoder = worker;
  } catch {
    decoder = null;
  }
  return decoder ?? undefined;
}

async function decodeOnMainThread<S extends z.ZodType>(bytes: ArrayBuffer, schema: S): Promise<z.infer<S>> {
  return schema.parse(await gunzipJson(new Uint8Array(bytes)));
}

/**
 * Like loadDataset for the large Earth datasets: gunzip, JSON and validation run in a worker (same schema), the
 * main thread only receives the result. Falls back to the main thread without a working worker; invalid data
 * still fail (DataUnavailableError).
 */
export async function loadBulkDataset<N extends BulkSchemaName>(
  baseUrl: string,
  manifest: Manifest,
  key: DatasetKey,
  schemaName: N,
): Promise<{ entry: DatasetEntry; data: z.infer<(typeof BULK_SCHEMAS)[N]> }> {
  type Data = z.infer<(typeof BULK_SCHEMAS)[N]>;
  const schema = BULK_SCHEMAS[schemaName];
  const worker = decodeWorker();
  if (!worker) {
    const r = await loadDataset(baseUrl, manifest, key, schema);
    return { entry: r.entry, data: r.data as Data };
  }
  const entry = manifest.datasets[key];
  if (!entry) throw new DataUnavailableError(`Dataset ${key} is not published`);
  const url = `${dataRoot(baseUrl)}${entry.path}?v=${entry.sha256.slice(0, 12)}`;
  const res = await fetch(url);
  if (!res.ok) throw new DataUnavailableError(`HTTP ${res.status} for ${url}`);
  const bytes = await res.arrayBuffer();
  // The worker failed while downloading: the bytes are still here.
  if (decoder !== worker) return { entry, data: (await decodeOnMainThread(bytes, schema)) as Data };
  const id = nextId++;
  try {
    const data = await new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, bytes, schema: schemaName }, [bytes]);
    });
    return { entry, data: data as Data };
  } catch (err) {
    if (!(err instanceof DecodeWorkerError)) throw err;
    // The bytes went to the dead worker: fetch again (from the HTTP cache) and decode here.
    const r = await loadDataset(baseUrl, manifest, key, schema);
    return { entry: r.entry, data: r.data as Data };
  }
}

/** Loads a state-vector table (mission or moon; rows of 7 little-endian Float64). */
export async function loadEphemeris(
  baseUrl: string,
  entry: Pick<EphemerisEntry, 'path' | 'sha256' | 'bytes'>,
): Promise<EphemerisTable> {
  const url = `${dataRoot(baseUrl)}${entry.path}?v=${entry.sha256.slice(0, 12)}`;
  const res = await fetch(url);
  if (!res.ok) throw new DataUnavailableError(`HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength !== entry.bytes) throw new DataUnavailableError(`Size mismatch for ${entry.path}`);
  const view = new DataView(buf);
  const data = new Float64Array(buf.byteLength / 8);
  for (let i = 0; i < data.length; i++) data[i] = view.getFloat64(i * 8, true);
  return new EphemerisTable(data);
}

/** Like loadDataset but resolves to undefined when the dataset is missing or broken (optional metadata). */
export async function loadOptionalDataset<S extends z.ZodType>(
  baseUrl: string,
  manifest: Manifest,
  key: DatasetKey,
  schema: S,
): Promise<{ entry: DatasetEntry; data: z.infer<S> } | undefined> {
  try {
    return await loadDataset(baseUrl, manifest, key, schema);
  } catch (err) {
    console.warn(`Optional dataset ${key} unavailable:`, err);
    return undefined;
  }
}
