import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPerigeeServer } from '../mcp/src/tools';
import { createEngine } from '../src/engine';
import type { FetchLike } from '../src/engine/data';
import { OmmListSchema, OperatorsCatalogSchema } from '../src/data/schemas';
import { buildCatalog } from '../src/earth/catalog';
import { satelliteStats } from '../src/earth/stats';

const gp = gzipSync(readFileSync('tests/fixtures/omm-sample.json'));
const operators = OperatorsCatalogSchema.parse(JSON.parse(readFileSync('catalog/operators.json', 'utf8')));
const statsGz = gzipSync(
  JSON.stringify(
    satelliteStats(
      buildCatalog(
        OmmListSchema.parse(JSON.parse(readFileSync('tests/fixtures/omm-sample.json', 'utf8'))),
        undefined,
        { starlink: [100830] },
        operators,
      ),
      Date.parse('2026-09-26T12:00:00Z'),
    ),
  ),
);
const manifest = {
  stats: {
    path: 'earth/stats.json.gz',
    bytes: statsGz.length,
    sha256: 'c'.repeat(64),
    generatedAt: '2026-09-26T12:00:00Z',
  },
  version: 1,
  generatedAt: '2026-09-26T12:00:00Z',
  datasets: {
    'earth.gp': {
      path: 'earth/gp.json.gz',
      source: 'CelesTrak',
      fetchedAt: '2026-09-26T12:00:00Z',
      count: 3,
      bytes: gp.length,
      sha256: 'a'.repeat(64),
    },
  },
  ephemerides: {},
};
const files: Record<string, Buffer> = {
  'data/manifest.json': Buffer.from(JSON.stringify(manifest)),
  'data/earth/gp.json.gz': gp,
  'data/earth/stats.json.gz': statsGz,
};
const fakeFetch: FetchLike = async (url) => {
  const body = files[new URL(url).pathname.slice(1)];
  return {
    ok: body !== undefined,
    status: body ? 200 : 404,
    arrayBuffer: async () =>
      body
        ? (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer)
        : new ArrayBuffer(0),
  };
};

const client = new Client({ name: 'test', version: '0' });
const imagesFetched: string[] = [];

beforeAll(async () => {
  const server = createPerigeeServer(createEngine({ baseUrl: 'https://example.test/', fetch: fakeFetch }), {
    version: 'test',
    fetchImage: async (url) => {
      imagesFetched.push(url);
      return new Uint8Array([1, 2, 3]);
    },
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
});

type Content = { type: string; text?: string; data?: string; mimeType?: string };
async function call(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError?: boolean; content: Content[]; structured: Record<string, unknown> }> {
  const r = await client.callTool({ name, arguments: args });
  return {
    isError: r.isError === true,
    content: r.content as Content[],
    structured: r.structuredContent as Record<string, unknown>,
  };
}

describe('MCP server', () => {
  it('lists the tools with instructions', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual([
      'perigee_find',
      'perigee_object',
      'perigee_state',
      'perigee_orbit',
      'perigee_passes',
      'perigee_sky',
      'perigee_events',
      'perigee_stats',
      'perigee_distance',
      'perigee_distance_series',
      'perigee_view',
      'perigee_define',
      'perigee_about',
    ]);
    expect(client.getInstructions()).toMatch(/provenance/);
  });

  it('computes a distance with provenance', async () => {
    const r = await call('perigee_distance', { from: 'earth', to: 'mars', date: '2026-12-01T00:00:00Z' });
    expect(r.isError).toBe(false);
    expect(r.structured['distanceAu']).toBeGreaterThan(0.5);
    expect(JSON.parse(r.content[0]?.text ?? '{}')).toEqual(r.structured);
  });

  it('gives the ISS state from the published elements', async () => {
    const r = await call('perigee_state', { id: '25544', date: '2026-09-26T10:00:00Z' });
    expect(r.structured['altitudeKm']).toBeGreaterThan(370);
    expect((r.structured['provenance'] as { model: string }[])[0]?.model).toBe('sgp4-gp');
  });

  it('returns object facts and, on request, the image', async () => {
    const r = await call('perigee_object', {
      id: 'site:perseverance-landing',
      lang: 'fr',
      include_image: true,
    });
    expect(r.structured['name']).toMatch(/Perseverance/);
    expect(r.content.map((c) => c.type)).toEqual(['text', 'image']);
    expect(r.content[1]?.mimeType).toBe('image/webp');
    expect(imagesFetched[0]).toMatch(/^https:\/\/example\.test\/images\/.+\.webp$/);
  });

  it('builds view and embed links', async () => {
    const r = await call('perigee_view', { id: 'mars', date: '2027-02-19T00:00:00Z', rate: 0, panel: true });
    expect(r.structured['url']).toBe(
      'https://example.test/?view=solar&sel=mars&t=2027-02-19T00%3A00%3A00Z&rate=0&follow=1',
    );
    expect(String(r.structured['embedUrl'])).toMatch(/embed=1&ui=panel$/);
    expect(String(r.structured['iframe'])).toContain('&amp;');
  });

  it('defines terms and reports errors as tool errors', async () => {
    const d = await call('perigee_define', { term: 'apogee' });
    expect((d.structured['definitions'] as unknown[]).length).toBe(1);
    const e = await call('perigee_object', { id: 'no-such-probe' });
    expect(e.isError).toBe(true);
    expect(e.content[0]?.text).toMatch(/perigee_find/);
    const bad = await call('perigee_view', { id: 'mars', date: 'soon' });
    expect(bad.isError).toBe(true);
  });

  it('gives the ground point, the orbit and the passes of the ISS', async () => {
    const s = await call('perigee_state', { id: '25544', date: '2026-09-26T10:00:00Z' });
    const g = s.structured['groundPoint'] as { body: string; latDeg: number };
    expect(g.body).toBe('earth');
    expect(Math.abs(g.latDeg)).toBeLessThanOrEqual(52);
    const o = await call('perigee_orbit', { id: '25544' });
    expect(o.structured['regime']).toBe('LEO');
    const p = await call('perigee_passes', {
      id: '25544',
      latitude: 45.5,
      longitude: -73.57,
      start: '2026-09-26T00:00:00Z',
      days: 2,
      time_zone: 'America/Toronto',
    });
    const passes = p.structured['passes'] as { rise: { local: string } }[];
    expect(passes.length).toBeGreaterThan(2);
    expect(passes[0]?.rise.local).toMatch(/^2026-09-2[56] \d\d:\d\d:\d\d$/);
    const bad = await call('perigee_passes', { id: 'mars', latitude: 0, longitude: 0 });
    expect(bad.isError).toBe(true);
  });

  it('describes the sky, the coming events and the satellite counts', async () => {
    const sky = await call('perigee_sky', {
      latitude: 45.5,
      longitude: -73.57,
      date: '2026-10-20T01:30:00Z',
      time_zone: 'America/Toronto',
      lang: 'fr',
    });
    expect(sky.structured['sky']).toBe('nuit noire');
    expect((sky.structured['moon'] as { phase: string }).phase).toBe('gibbeuse croissante');
    const ev = await call('perigee_events', { start: '2027-02-01T00:00:00Z', days: 30, kinds: ['planet'] });
    expect(
      (ev.structured['events'] as { title: string }[]).some((e) => e.title === 'Mars at opposition'),
    ).toBe(true);
    const half = await call('perigee_events', { latitude: 10 });
    expect(half.isError).toBe(true);
    const st = await call('perigee_stats', { operator: 'spacex' });
    expect(st.structured['total']).toBe(3);
    expect((st.structured['operators'] as { rows: { id: string; total: number }[] }).rows).toEqual([
      expect.objectContaining({ id: 'spacex', total: 1 }),
    ]);
  });

  it('describes its sources and models', async () => {
    const r = await call('perigee_about');
    expect(Object.keys(r.structured['models'] as object)).toContain('horizons-interpolated');
  });
});
