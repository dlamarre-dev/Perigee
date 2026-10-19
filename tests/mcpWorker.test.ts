import { describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine';
import type { FetchLike } from '../src/engine/data';
import { handle, type HandlerOptions } from '../workers/mcp/src/handler';
import { agentOf, callsOf, type UsageEntry } from '../workers/mcp/src/usageLog';

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
    expect(tools.find((t) => t.name === 'perigee_passes')?.inputSchema.properties['days']?.maximum).toBe(3);
    expect(tools.find((t) => t.name === 'perigee_events')?.inputSchema.properties['days']?.maximum).toBe(31);
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

describe('usage log of the hosted endpoint', () => {
  const run = async (body: unknown, extra: Partial<HandlerOptions> = {}): Promise<UsageEntry[]> => {
    const entries: UsageEntry[] = [];
    await handle(rpc(body), options({ log: (e) => entries.push(e), isolateRequest: 1, ...extra }));
    return entries;
  };

  it('records the tool, the object asked about and the outcome, never coordinates or the address', async () => {
    const [sky] = await run({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'perigee_sky', arguments: { latitude: 45.50884, longitude: -73.58781, lang: 'fr' } },
    });
    expect(sky).toMatchObject({ evt: 'mcp', status: 200, isolateRequest: 1 });
    expect(sky?.calls).toEqual([
      { method: 'tools/call', tool: 'perigee_sky', args: ['lang', 'latitude', 'longitude'], ok: true },
    ]);
    const text = JSON.stringify(sky);
    expect(text).not.toContain('45.50884');
    expect(text).not.toContain('73.58781');
    expect(text).not.toContain('203.0.113.7');

    const [dist] = await run({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'perigee_distance',
        arguments: { from: 'earth', to: 'mars', date: '2026-12-01T00:00:00Z' },
      },
    });
    expect(dist?.calls[0]).toMatchObject({ tool: 'perigee_distance', objectId: 'earth → mars', ok: true });
  });

  it('records tool errors, clients and refusals', async () => {
    const [bad] = await run({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'perigee_object', arguments: { id: 'no-such-probe' } },
    });
    expect(bad?.calls[0]).toMatchObject({
      objectId: 'no-such-probe',
      ok: false,
      error: expect.stringMatching(/Unknown object/),
    });

    const [init] = await run({
      jsonrpc: '2.0',
      id: 4,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'claude-ai', version: '0.1.0' },
      },
    });
    expect(init?.calls).toEqual([{ method: 'initialize', client: 'claude-ai 0.1.0' }]);

    const [limited] = await run(
      { jsonrpc: '2.0', id: 5, method: 'tools/list' },
      { limiter: { limit: async () => ({ success: false }) } },
    );
    expect(limited).toMatchObject({ status: 429, rateLimited: true, calls: [{ method: 'tools/list' }] });
  });

  it('keeps only the first token of the User-Agent', () => {
    expect(agentOf('python-httpx/0.27.0 (something)')).toBe('python-httpx');
    const [link] = callsOf({
      method: 'tools/call',
      params: {
        name: 'perigee_describe_view',
        arguments: { url: 'https://perigee.info/?view=solar&sel=mars&t=2026-12-01T00:00:00Z' },
      },
    });
    expect(link?.objectId).toBe('solar mars');
    expect(agentOf(null)).toBeUndefined();
    expect(callsOf([{ method: 'notifications/initialized' }, 'junk'])).toEqual([
      { method: 'notifications/initialized' },
    ]);
  });
});
