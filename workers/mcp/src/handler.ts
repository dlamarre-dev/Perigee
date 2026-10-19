/**
 * Perigee's hosted MCP endpoint (Cloudflare Worker): the tools of mcp/src/tools.ts over Streamable HTTP, stateless
 * (one server per request, JSON responses), for AI services that cannot start a local server. Same engine and
 * published data as the npm package; data files are kept in the Cache API by content hash. Visitors' addresses are
 * only used, in memory, by the per-IP rate limiter; nothing is logged.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Engine } from '../../../src/engine';
import { createPerigeeServer } from '../../../mcp/src/tools';

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface HandlerOptions {
  readonly version: string;
  readonly engine: () => Engine;
  readonly fetchImage?: (url: string) => Promise<Uint8Array>;
  readonly limiter?: RateLimiter | undefined;
}

/** Largest accepted request body (a tool call is a few hundred bytes). */
const MAX_BODY_BYTES = 64 * 1024;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

function withCors(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return withCors(
    new Response(`${JSON.stringify(body, null, 1)}\n`, {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    }),
  );
}

export async function handle(request: Request, options: HandlerOptions): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));

  if (url.pathname === '/' && request.method === 'GET') {
    return jsonResponse({
      name: 'perigee-mcp',
      version: options.version,
      description:
        "Perigee's MCP server: positions, distances, mission facts, definitions and embeddable 3D views of the objects orbiting the Earth, the Moon, Mars and the Sun, with provenance and accuracy. For education.",
      mcp: `${url.origin}/mcp`,
      transport: 'Streamable HTTP (stateless, JSON responses)',
      local: 'npx -y perigee-mcp',
      documentation: 'https://perigee.info/api/interface.json',
      source: 'https://github.com/dlamarre-dev/Perigee',
      privacy: 'https://perigee.info/privacy.html',
    });
  }
  if (url.pathname !== '/mcp') return jsonResponse({ error: 'Not found: the MCP endpoint is /mcp' }, 404);

  if (options.limiter) {
    const key = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const { success } = await options.limiter.limit({ key });
    if (!success)
      return jsonResponse(
        { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Too many requests: wait a minute' } },
        429,
        { 'Retry-After': '60' },
      );
  }
  const length = Number(request.headers.get('Content-Length') ?? '0');
  if (length > MAX_BODY_BYTES)
    return jsonResponse(
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } },
      413,
    );

  const server = createPerigeeServer(options.engine(), {
    version: options.version,
    // A Worker request has little CPU (10 ms on the free plan): each sample of a satellite costs an SGP4 run.
    maxSeriesSteps: 100,
    maxPassDays: 3,
    ...(options.fetchImage ? { fetchImage: options.fetchImage } : {}),
  });
  // No session id generator: stateless mode, one server per request.
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(request));
  } finally {
    void server.close();
  }
}
