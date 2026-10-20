/**
 * Cloudflare Worker entry of the hosted MCP endpoint (./handler.ts). One engine per isolate: the parsed datasets
 * stay in its memory between requests. There is no byte cache: Cloudflare's Cache API does nothing on a
 * *.workers.dev host, so a new isolate downloads what it needs from perigee.info (GitHub Pages' CDN, a few small
 * files: one shard, the name index, an ephemeris), checked against the manifest's hashes.
 */
import mcpPackage from '../../../mcp/package.json';
import { createEngine, type Engine } from '../../../src/engine';
import { handle, parseDisabledTools, type RateLimiter } from './handler';

interface Env {
  readonly PERIGEE_SITE?: string;
  /** Circuit breaker, set in the dashboard (Settings → Variables): "series,passes", or "*" to pause everything. */
  readonly PERIGEE_MCP_DISABLED_TOOLS?: string;
  readonly LIMITER?: RateLimiter;
}

const USER_AGENT = `perigee-mcp-worker/${mcpPackage.version} (+https://github.com/dlamarre-dev/Perigee)`;
const get = (url: string): Promise<Response> => fetch(url, { headers: { 'User-Agent': USER_AGENT } });

let engine: Engine | undefined;
/** Requests served by this isolate (the first one is a cold start). */
let served = 0;

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const configured = env.PERIGEE_SITE ?? 'https://perigee.info/';
    const site = configured.endsWith('/') ? configured : `${configured}/`;
    return handle(request, {
      version: mcpPackage.version,
      engine: () => (engine ??= createEngine({ baseUrl: site, fetch: get })),
      fetchImage: async (url) => {
        // Only the site's own images (the engine builds these URLs from the catalogue): no other egress.
        if (!url.startsWith(`${site}images/`)) throw new Error(`Image outside ${site}images/: ${url}`);
        const res = await get(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return new Uint8Array(await res.arrayBuffer());
      },
      limiter: env.LIMITER,
      isolateRequest: ++served,
      disabledTools: parseDisabledTools(env.PERIGEE_MCP_DISABLED_TOOLS),
      // Workers Logs index the fields of a logged object (wrangler.jsonc: invocation logs off, no IP addresses).
      log: (entry) => console.log(entry),
    });
  },
};
