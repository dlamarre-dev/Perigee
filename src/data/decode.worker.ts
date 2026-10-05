/// <reference lib="webworker" />
/**
 * Decodes a large dataset (16k OMMs, 17k SATCAT records: ~150 ms of gunzip, JSON and validation on a desktop,
 * several times that on a phone) so the main thread only receives the result.
 */
import { BULK_SCHEMAS, gunzipJson, type BulkSchemaName } from './decode';

interface Request {
  readonly id: number;
  readonly bytes: ArrayBuffer;
  readonly schema: BulkSchemaName;
}

self.onmessage = async (e: MessageEvent<Request>): Promise<void> => {
  const { id, bytes, schema } = e.data;
  try {
    const data = BULK_SCHEMAS[schema].parse(await gunzipJson(new Uint8Array(bytes)));
    self.postMessage({ id, data });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
