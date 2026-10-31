import { createHash } from 'node:crypto';
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
    sha256: createHash('sha256').update(statsGz).digest('hex'),
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
      sha256: createHash('sha256').update(gp).digest('hex'),
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
      'perigee_tonight',
      'perigee_sky_conjunctions',
      'perigee_shadow',
      'perigee_ground_track',
      'perigee_close_approach',
      'perigee_stats',
      'perigee_distance',
      'perigee_distance_series',
      'perigee_view',
      'perigee_describe_view',
      'perigee_define',
      'perigee_about',
    ]);
    expect(client.getInstructions()).toMatch(/provenance/);
  });

  it('describes every tool and every argument, and marks them read-only', async () => {
    // Registries and directories (mcptry.com, Glama) score tool quality on these.
    for (const tool of (await client.listTools()).tools) {
      expect(tool.description?.length, tool.name).toBeGreaterThan(40);
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      for (const [arg, schema] of Object.entries(tool.inputSchema.properties ?? {}))
        expect((schema as { description?: string }).description, `${tool.name}.${arg}`).toBeTruthy();
    }
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
    const map = await call('perigee_view', { id: 'star:sirius', star_map: true, compare: 'star:vega' });
    expect(String(map.structured['embedUrl'])).toMatch(/sel=star%3Asirius&map=1&pick=star%3Avega&embed=1$/);
  });

  it('answers the shadow, ground track, close approach, conjunction and tonight tools', async () => {
    const at = '2026-09-26T10:00:00Z';
    const shadow = await call('perigee_shadow', { id: '25544', date: at });
    expect(shadow.isError).toBe(false);
    expect(['sunlight', 'penumbra', 'umbra']).toContain(shadow.structured['light']);
    // Two orbits: at least one entry into the shadow and one exit.
    const changes = shadow.structured['changes'] as { to: string }[];
    expect(changes.some((c) => c.to === 'umbra')).toBe(true);
    expect(changes.some((c) => c.to === 'sunlight')).toBe(true);

    const track = await call('perigee_ground_track', { id: '25544', start: at, points: 90 });
    expect(track.structured['count']).toBe(91);
    expect((track.structured['geojson'] as { type: string }).type).toBe('MultiLineString');

    const approach = await call('perigee_close_approach', { from: '25544', to: '20580', start: at });
    expect((approach.structured['closest'] as { distanceKm: number }).distanceKm).toBeGreaterThan(0);
    expect(approach.structured['warning']).toMatch(/collision avoidance/);
    expect((await call('perigee_close_approach', { from: '25544', to: '25544' })).isError).toBe(true);

    const pairs = await call('perigee_sky_conjunctions', {
      latitude: 45.5,
      longitude: -73.57,
      start: at,
      days: 3,
    });
    expect(pairs.isError).toBe(false);
    expect(Array.isArray(pairs.structured['conjunctions'])).toBe(true);

    const night = await call('perigee_tonight', {
      latitude: 45.5,
      longitude: -73.57,
      date: '2026-09-26T20:00:00Z',
      time_zone: 'America/Toronto',
      lang: 'fr',
    });
    expect(night.isError).toBe(false);
    expect((night.structured['highlights'] as string[])[0]).toMatch(/^Nuit de /);
    // French texts: west is O in compass points (the codes stay English in the fields).
    for (const h of night.structured['highlights'] as string[])
      expect(h).not.toMatch(/\((?:[NSE]*W[NSEW]*)[ ,→)]/);
    expect(night.structured['notes']).toMatch(/^Nuit : /);

    const ombre = await call('perigee_shadow', { id: '25544', date: at, lang: 'fr' });
    expect(String(ombre.structured['lightLabel'])).toMatch(/soleil|ombre|pénombre/);
    expect(ombre.structured['notes']).toMatch(/^Pénombre/);
    const proche = await call('perigee_close_approach', {
      from: '25544',
      to: '20580',
      start: at,
      lang: 'fr',
    });
    expect(proche.structured['warning']).toMatch(/jamais pour éviter une collision/);
    const passes = await call('perigee_passes', {
      id: '25544',
      latitude: 45.5,
      longitude: -73.57,
      start: at,
      lang: 'fr',
    });
    expect(passes.structured['accuracy']).toMatch(/^Heures à quelques secondes/);
    expect((night.structured['night'] as { from: { local: string } }).from.local).toMatch(/^2026-09-26 /);
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

  it('puts a view link into words', async () => {
    const r = await call('perigee_describe_view', {
      url: 'https://perigee.info/?view=solar&sel=mars',
      lang: 'fr',
    });
    expect(String(r.structured['altText'])).toMatch(/^Vue 3D de Périgée : vue du Système solaire/);
    expect(String(r.structured['description'])).toMatch(/Mars/);
  });

  it('describes its sources and models', async () => {
    const r = await call('perigee_about');
    expect(Object.keys(r.structured['models'] as object)).toContain('horizons-interpolated');
  });
});
