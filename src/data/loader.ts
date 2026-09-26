/**
 * Client-side data loading. Reads `data/manifest.json` first, then gzip-compressed datasets from the same
 * origin (published from the `data` branch). Never contacts upstream providers.
 */
import type { z } from 'zod';
import { ManifestSchema, type DatasetEntry, type DatasetKey, type Manifest } from './schemas';

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

async function gunzipJson(res: Response): Promise<unknown> {
  if (!res.body) throw new DataUnavailableError('Empty response body');
  // Servers may already have decoded a gzip Content-Encoding; detect the magic bytes.
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(bytes));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
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
  return { entry, data: schema.parse(await gunzipJson(res)) };
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
