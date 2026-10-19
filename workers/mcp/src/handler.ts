/**
 * Perigee's hosted MCP endpoint (Cloudflare Worker): the tools of mcp/src/tools.ts over Streamable HTTP, stateless
 * (one server per request, JSON responses), for AI services that cannot start a local server. Same engine and
 * published data as the npm package; data files are kept in the Cache API by content hash. Visitors' addresses are
 * only used, in memory, by the per-IP rate limiter; the usage log (./usageLog.ts) never records them.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Engine } from '../../../src/engine';
import { createPerigeeServer } from '../../../mcp/src/tools';
import { agentOf, callsOf, withOutcomes, type UsageEntry } from './usageLog';

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface HandlerOptions {
  readonly version: string;
  readonly engine: () => Engine;
  readonly fetchImage?: (url: string) => Promise<Uint8Array>;
  readonly limiter?: RateLimiter | undefined;
  /** Receives one usage entry per MCP request (Workers Logs in production). */
  readonly log?: (entry: UsageEntry) => void;
  /** Rank of this request in its isolate (1: a cold start). */
  readonly isolateRequest?: number;
  /**
   * Circuit breaker (Worker variable PERIGEE_MCP_DISABLED_TOOLS): tool names or name ends switched off, e.g.
   * ["series", "passes"]; ["*"] closes the endpoint (503) without running anything (docs/mcp-hosted.md, playbook).
   */
  readonly disabledTools?: readonly string[];
}

/** Largest accepted request body (a tool call is a few hundred bytes). */
const MAX_BODY_BYTES = 64 * 1024;
/** JSON-RPC batches (older MCP revisions) are limited to this many messages. */
export const MAX_BATCH = 4;

/**
 * Rate-limit units of a tool call, about its CPU cost: the limiter counts each unit, so a request of an expensive
 * tool (or a batch) costs more of a caller's budget than a definition lookup. Unlisted tools and other messages: 1.
 */
export const TOOL_COST: Readonly<Record<string, number>> = {
  perigee_distance_series: 4,
  perigee_passes: 3,
  perigee_events: 3,
  perigee_sky: 2,
  perigee_find: 2,
};

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
  // Stateless: no stream of server notifications. A GET (or a session DELETE) gets 405, as the Streamable HTTP
  // transport specifies; answering GET with an event stream that closes at once made clients reconnect in a loop
  // (thousands of requests an hour from one Claude Code session).
  if (request.method !== 'POST')
    return withCors(
      new Response(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed: POST JSON-RPC to /mcp (stateless server, no event stream)' } })}\n`,
        {
          status: 405,
          headers: { Allow: 'POST, OPTIONS', 'Content-Type': 'application/json; charset=utf-8' },
        },
      ),
    );

  // Circuit breaker, fully open: nothing runs (the request still counts in Cloudflare's daily quota).
  if (options.disabledTools?.includes('*'))
    return jsonResponse(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message:
            'The hosted Perigee server is paused for maintenance. Use the local server: npx -y perigee-mcp',
        },
      },
      503,
      { 'Retry-After': '3600' },
    );

  const started = Date.now();
  const cf = (request as Request & { cf?: { country?: string; colo?: string } }).cf;
  const agent = agentOf(request.headers.get('User-Agent'));
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  const text = declared > MAX_BODY_BYTES ? '' : await request.clone().text();
  if (declared > MAX_BODY_BYTES || text.length > MAX_BODY_BYTES)
    return jsonResponse(
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } },
      413,
    );
  let requestBody: unknown;
  try {
    requestBody = JSON.parse(text);
  } catch {
    requestBody = undefined;
  }
  const calls = callsOf(requestBody);
  if (Array.isArray(requestBody) && requestBody.length > MAX_BATCH)
    return jsonResponse(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: `Batches are limited to ${MAX_BATCH} messages` },
      },
      400,
    );
  const log = (status: number, outcome: Partial<UsageEntry> = {}): void =>
    options.log?.({
      evt: 'mcp',
      status,
      ms: Date.now() - started,
      isolateRequest: options.isolateRequest ?? 0,
      calls,
      ...(cf?.country ? { country: cf.country } : {}),
      ...(cf?.colo ? { colo: cf.colo } : {}),
      ...(agent ? { agent } : {}),
      ...outcome,
    });

  if (options.limiter) {
    const key = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    // One unit per message, more for the expensive tools (TOOL_COST): batches and costly calls count in full.
    const units = Math.max(
      1,
      calls.reduce((n, c) => n + (c.tool ? (TOOL_COST[c.tool] ?? 1) : 1), 0),
    );
    let allowed = true;
    for (let i = 0; i < units && allowed; i++) allowed = (await options.limiter.limit({ key })).success;
    if (!allowed) log(429, { rateLimited: true });
    if (!allowed)
      return jsonResponse(
        { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Too many requests: wait a minute' } },
        429,
        { 'Retry-After': '60' },
      );
  }

  const server = createPerigeeServer(options.engine(), {
    version: options.version,
    // A Worker request has little CPU (10 ms on the free plan): each sample of a satellite costs an SGP4 run.
    maxSeriesSteps: 100,
    maxPassDays: 3,
    maxEventDays: 31,
    ...(options.disabledTools?.length ? { disabledTools: options.disabledTools } : {}),
    ...(options.fetchImage ? { fetchImage: options.fetchImage } : {}),
  });
  // No session id generator: stateless mode, one server per request.
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const response = withCors(await transport.handleRequest(request));
    if (options.log) {
      const json = response.headers.get('Content-Type')?.includes('application/json');
      const responseBody = json
        ? await response
            .clone()
            .json()
            .catch(() => undefined)
        : undefined;
      log(response.status, { calls: withOutcomes(calls, requestBody, responseBody) });
    }
    return response;
  } catch (err) {
    log(500, { calls: calls.map((c) => ({ ...c, ok: false, error: String(err).slice(0, 120) })) });
    throw err;
  } finally {
    void server.close();
  }
}
