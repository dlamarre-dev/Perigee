import { describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine';
import type { FetchLike } from '../src/engine/data';
import { handle, type HandlerOptions } from '../workers/mcp/src/handler';

// Planet answers need no published data: a fetch that fails proves it.
const noData: FetchLike = async () => ({
  ok: false,
  status: 404,
  arrayBuffer: async () => new ArrayBuffer(0),
});
const engine = createEngine({ baseUrl: 'https://example.test/', fetch: noData });
const options = (extra: Partial<HandlerOptions> = {}): HandlerOptions => ({
  version: 'test',
  engine: () => engine,
  ...extra,
});

const rpc = (body: unknown): Request =>
  new Request('https://mcp.example/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Mcp-Protocol-Version': '2025-06-18',
      'CF-Connecting-IP': '203.0.113.7',
    },
    body: JSON.stringify(body),
  });

describe('hosted MCP endpoint', () => {
  it('describes itself at the root', async () => {
    const res = await handle(new Request('https://mcp.example/'), options());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'perigee-mcp', mcp: 'https://mcp.example/mcp' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('answers CORS preflights and unknown paths', async () => {
    expect(
      (await handle(new Request('https://mcp.example/mcp', { method: 'OPTIONS' }), options())).status,
    ).toBe(204);
    expect((await handle(new Request('https://mcp.example/other'), options())).status).toBe(404);
  });

  it('runs a stateless tool call', async () => {
    const init = await handle(
      rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
      options(),
    );
    expect(init.status).toBe(200);
    expect(((await init.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe(
      'perigee',
    );
    const call = await handle(
      rpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'perigee_distance',
          arguments: { from: 'earth', to: 'mars', date: '2026-12-01T00:00:00Z' },
        },
      }),
      options(),
    );
    const out = (await call.json()) as { result: { structuredContent: { distanceAu: number } } };
    expect(out.result.structuredContent.distanceAu).toBeGreaterThan(0.5);
  });

  it('caps distance series to its CPU budget', async () => {
    const res = await handle(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), options());
    const tools = (
      (await res.json()) as {
        result: {
          tools: { name: string; inputSchema: { properties: Record<string, { maximum?: number }> } }[];
        };
      }
    ).result.tools;
    expect(
      tools.find((t) => t.name === 'perigee_distance_series')?.inputSchema.properties['steps']?.maximum,
    ).toBe(100);
  });

  it('rate-limits by caller address', async () => {
    const keys: string[] = [];
    const res = await handle(
      rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      options({ limiter: { limit: async ({ key }) => (keys.push(key), { success: false }) } }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(keys).toEqual(['203.0.113.7']);
  });

  it('refuses oversized requests', async () => {
    const req = new Request('https://mcp.example/mcp', {
      method: 'POST',
      headers: { 'Content-Length': '100000' },
      body: 'x',
    });
    expect((await handle(req, options())).status).toBe(413);
  });
});
