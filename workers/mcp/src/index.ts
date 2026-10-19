/**
 * Cloudflare Worker entry of the hosted MCP endpoint (./handler.ts). One engine per isolate: the parsed datasets
 * stay in memory between requests, and the raw files in the data centre's Cache API, keyed by content hash.
 */
import mcpPackage from '../../../mcp/package.json';
import { createEngine, type Engine } from '../../../src/engine';
import type { ByteCache } from '../../../src/engine/data';
import { handle, type RateLimiter } from './handler';

interface Env {
  readonly PERIGEE_SITE?: string;
  readonly LIMITER?: RateLimiter;
}

/** Cloudflare's per-data-centre cache (`caches.default`), absent outside Workers. */
const edgeCache = (): Cache | undefined => (globalThis.caches as { default?: Cache } | undefined)?.default;

class EdgeCache implements ByteCache {
  private readonly url = (key: string): string => `https://perigee-mcp.cache/${encodeURIComponent(key)}`;

  async get(key: string): Promise<ArrayBuffer | undefined> {
    const hit = await edgeCache()?.match(this.url(key));
    return hit ? hit.arrayBuffer() : undefined;
  }

  async set(key: string, bytes: ArrayBuffer): Promise<void> {
    // Content-addressed: a week is safe (a newer version has another key).
    await edgeCache()?.put(
      this.url(key),
      new Response(bytes, { headers: { 'Cache-Control': 'public, max-age=604800' } }),
    );
  }
}

const USER_AGENT = `perigee-mcp-worker/${mcpPackage.version} (+https://github.com/dlamarre-dev/Perigee)`;
const get = (url: string): Promise<Response> => fetch(url, { headers: { 'User-Agent': USER_AGENT } });

let engine: Engine | undefined;
/** Requests served by this isolate (the first one is a cold start). */
let served = 0;

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const site = env.PERIGEE_SITE ?? 'https://perigee.info/';
    return handle(request, {
      version: mcpPackage.version,
      engine: () => (engine ??= createEngine({ baseUrl: site, fetch: get, cache: new EdgeCache() })),
      fetchImage: async (url) => {
        const res = await get(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return new Uint8Array(await res.arrayBuffer());
      },
      limiter: env.LIMITER,
      isolateRequest: ++served,
      // Workers Logs index the fields of a logged object (wrangler.jsonc: invocation logs off, no IP addresses).
      log: (entry) => console.log(entry),
    });
  },
};
