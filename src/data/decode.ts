/**
 * Decoding of the published datasets: gzip (unless the server already decoded it) → JSON → zod. Shared by the
 * main thread and the decode worker (./decode.worker.ts), which runs it for the large Earth datasets.
 */
import { OmmListSchema, SatcatListSchema } from './schemas';

/** Large datasets decoded off the main thread, by schema name (schemas cannot cross to a worker). */
export const BULK_SCHEMAS = { omm: OmmListSchema, satcat: SatcatListSchema } as const;
export type BulkSchemaName = keyof typeof BULK_SCHEMAS;

export async function gunzipJson(bytes: Uint8Array): Promise<unknown> {
  // Servers may already have decoded a gzip Content-Encoding; detect the magic bytes.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(bytes));
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
