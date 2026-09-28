/**
 * CelesTrak fetchers (GP/OMM and SATCAT). Fetch, validate, reformat only — no astrodynamics here.
 * Usage policy: data refreshes every ~2 h; one download per update cycle and resource.
 */
import type { z } from 'zod';
import {
  OmmListSchema,
  OmmSchema,
  SatcatListSchema,
  SatcatRecordSchema,
  type Omm,
  type SatcatRecord,
} from '../src/data/schemas';
import { ProviderError, politeGet } from './http';

const BASE = 'https://celestrak.org';

export const gpUrl = (group: string): string =>
  `${BASE}/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=JSON`;
/** SATCAT records of the same "active" group as the GP data (records.php requires a search field). */
export const SATCAT_URL = `${BASE}/satcat/records.php?GROUP=active&FORMAT=JSON`;

/** CelesTrak answers 200 with a plain-text notice when nothing changed since this IP's last download. */
export class NotUpdatedError extends Error {
  constructor(readonly url: string) {
    super(`CelesTrak reports no update since the last download: ${url}`);
    this.name = 'NotUpdatedError';
  }
}

function parseJsonBody(body: string, url: string): unknown {
  const trimmed = body.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
    if (/not updated|has not updated/i.test(trimmed)) throw new NotUpdatedError(url);
    throw new ProviderError(`Unexpected non-JSON response: ${trimmed.slice(0, 200)}`, url, 200);
  }
  return JSON.parse(trimmed);
}

export interface ParsedList<T> {
  readonly records: T[];
  /** Malformed rows dropped rather than failing the whole dataset. */
  readonly rejected: number;
}

function parseRows<T>(json: unknown, url: string, schema: z.ZodType<T>): ParsedList<T> {
  if (!Array.isArray(json)) throw new ProviderError('Response is not a JSON array', url, 200);
  const records: T[] = [];
  let rejected = 0;
  for (const row of json) {
    const parsed = schema.safeParse(row);
    if (parsed.success) records.push(parsed.data);
    else rejected++;
  }
  return { records, rejected };
}

export async function fetchGp(group: string): Promise<ParsedList<Omm>> {
  const url = gpUrl(group);
  const result = parseRows(
    parseJsonBody(await politeGet(url, { accept: 'application/json' }), url),
    url,
    OmmSchema,
  );
  OmmListSchema.parse(result.records);
  return result;
}

const SATCAT_TIMEOUT_MS = 300_000;

export async function fetchSatcatActive(): Promise<ParsedList<SatcatRecord>> {
  const url = SATCAT_URL;
  // The server builds ~16k records on the fly (~20 s normally); on 2026-09-28 it did not answer within 120 s.
  // Still a single attempt, no retry (CelesTrak policy), just a longer wait.
  const body = await politeGet(url, { accept: 'application/json', timeoutMs: SATCAT_TIMEOUT_MS });
  const result = parseRows(parseJsonBody(body, url), url, SatcatRecordSchema);
  SatcatListSchema.parse(result.records);
  return result;
}
