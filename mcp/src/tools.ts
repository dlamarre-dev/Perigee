/**
 * Perigee's MCP tools, shared by the local stdio server (./cli.ts) and the hosted endpoint (workers/mcp): thin
 * wrappers over the headless engine (src/engine). Every computed answer carries its provenance (model, sources,
 * fetch time, element age, validity window, data state, typical accuracy) and the educational-use disclaimer.
 * Data come from Perigee's published files (https://perigee.info/data/); CelesTrak and Horizons are never contacted.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Engine } from '../../src/engine';

export const SERVER_NAME = 'perigee';

export interface ToolOptions {
  /** Version reported to clients. */
  readonly version: string;
  /** Fetches a catalogue image (WebP) for `include_image`; omitted: images are only linked. */
  readonly fetchImage?: (url: string) => Promise<Uint8Array>;
}

const INSTRUCTIONS = `Perigee (https://perigee.info/) shows in 3D, in real time, the artificial objects orbiting the Earth, the Moon and Mars and the spacecraft crossing the solar system, for education.
Use perigee_find to get an object's id (NORAD number, mission id, planet, "moon:<id>", "site:<id>", "launch:<id>", "star:<id>"), then perigee_object for facts (goals, status, sources, an image with its credit), perigee_state / perigee_distance / perigee_distance_series for computed values, perigee_view for a link or an embeddable live 3D view, perigee_define for student-level definitions.
Always tell the student how reliable a number is: quote the provenance (model, data state, data age, typical accuracy) and the sources. Positions are for education, not navigation.`;

const lang = z.enum(['en', 'fr']).optional().describe('Language of names and texts (default en).');
const date = z
  .string()
  .optional()
  .describe('ISO 8601 UTC instant, e.g. 2026-12-01T00:00:00Z (default: now).');
const id = z.string().min(1).max(100);

function json(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 1) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function failure(err: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
    isError: true,
  };
}

const guard =
  <A>(fn: (args: A) => Promise<CallToolResult> | CallToolResult) =>
  async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (err) {
      return failure(err);
    }
  };

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function createPerigeeServer(engine: Engine, options: ToolOptions): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: options.version },
    { instructions: INSTRUCTIONS },
  );
  const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

  server.registerTool(
    'perigee_find',
    {
      title: 'Find an object',
      description:
        'Looks up objects by name or identifier (English or French, accents optional): planets, moons, missions beyond Earth orbit, featured science satellites, any active Earth satellite (by name, NORAD or COSPAR id), landing and launch sites, named stars. Returns ids for the other tools.',
      inputSchema: { query: z.string().min(1).max(100), limit: z.number().int().min(1).max(50).optional() },
      annotations: readOnly,
    },
    guard(async ({ query, limit }) => json({ results: await engine.find(query, limit ?? 10) })),
  );

  server.registerTool(
    'perigee_object',
    {
      title: 'Object facts',
      description:
        'Facts about an object: name, agency, country, launch date, status, mission goals and notes, identifiers (NORAD, COSPAR, Horizons), official website, sources and verification date, a catalogue image with credit and licence, and links to its view in Perigee. include_image also returns the image itself.',
      inputSchema: { id, lang, include_image: z.boolean().optional() },
      annotations: readOnly,
    },
    guard(async ({ id: objectId, lang: l, include_image }) => {
      const facts = await engine.describe(objectId, l ?? 'en');
      const result = json(facts);
      const image = facts['image'] as { url?: string } | undefined;
      if (include_image && image?.url && options.fetchImage) {
        const bytes = await options.fetchImage(image.url);
        result.content.push({ type: 'image', data: base64(bytes), mimeType: 'image/webp' });
      }
      return result;
    }),
  );

  server.registerTool(
    'perigee_state',
    {
      title: 'Position and velocity',
      description:
        'Position (km, ICRF/J2000 equatorial axes) and velocity (km/s) of an object at a date, relative to a centre (default: the body it orbits or stands on), with distance, altitude above the centre, speed, light time and provenance.',
      inputSchema: {
        id,
        date,
        centre: z
          .string()
          .optional()
          .describe('Reference object id, e.g. "earth", "sun", "moon:moon", "mars".'),
      },
      annotations: readOnly,
    },
    guard(async ({ id: objectId, date: d, centre }) => json(await engine.state(objectId, d, centre))),
  );

  server.registerTool(
    'perigee_distance',
    {
      title: 'Distance between two objects',
      description:
        'Centre-to-centre distance between two objects at a date (km and astronomical units) and the light travel time, with the provenance of both positions. Example: from "earth" to "mars".',
      inputSchema: { from: id, to: id, date },
      annotations: readOnly,
    },
    guard(async ({ from, to, date: d }) => json(await engine.distance(from, to, d))),
  );

  server.registerTool(
    'perigee_distance_series',
    {
      title: 'Distance over a period',
      description:
        'Distances between two objects sampled evenly over a period (for a table or a chart), with the closest and farthest samples. The step limits their precision: use more steps for a precise closest approach.',
      inputSchema: {
        from: id,
        to: id,
        start: z.string().describe('ISO 8601 UTC start.'),
        end: z.string().describe('ISO 8601 UTC end.'),
        steps: z.number().int().min(1).max(1000).optional().describe('Number of intervals (default 50).'),
      },
      annotations: readOnly,
    },
    guard(async ({ from, to, start, end, steps }) =>
      json(await engine.series(from, to, start, end, steps ?? 50)),
    ),
  );

  server.registerTool(
    'perigee_view',
    {
      title: 'Link or embed a 3D view',
      description:
        'Link to Perigee showing an object (optionally at a date, paused or accelerated, followed), and an iframe snippet for a lesson page: the live 3D view without bars or panels. The embedding page can then drive the view and take PNG snapshots with postMessage (protocol perigee:v1, documented in `embedApi`).',
      inputSchema: {
        id,
        date,
        lang,
        rate: z
          .number()
          .min(-100000)
          .max(100000)
          .optional()
          .describe('Time multiplier: 1 real time, 0 paused.'),
        follow: z.boolean().optional().describe('Follow the object (default true).'),
        panel: z.boolean().optional().describe('Keep the information panel in the embed.'),
        time_bar: z.boolean().optional().describe('Keep the time bar in the embed.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(({ id: objectId, date: d, lang: l, rate, follow, panel, time_bar }) => {
      const when = d ? new Date(d) : undefined;
      if (when && Number.isNaN(when.getTime())) throw new Error(`Invalid date: ${d}`);
      const opts = {
        ...(when ? { date: when } : {}),
        ...(l ? { lang: l } : {}),
        ...(rate !== undefined ? { rate } : {}),
        follow: follow ?? true,
      };
      const embedUrl = new URL(engine.viewUrl(objectId, { ...opts, embed: true }));
      const ui = [panel && 'panel', time_bar && 'time'].filter(Boolean).join(',');
      if (ui) embedUrl.searchParams.set('ui', ui);
      return json({
        url: engine.viewUrl(objectId, opts),
        embedUrl: embedUrl.href,
        iframe: `<iframe src="${embedUrl.href.replaceAll('&', '&amp;')}" width="800" height="500" style="border:0" allow="fullscreen" title="Perigee"></iframe>`,
        embedApi: {
          protocol: 'perigee:v1',
          snapshot:
            "iframe.contentWindow.postMessage({ type: 'perigee:v1', id: 1, method: 'snapshot', params: { kind: 'shown' } }, '*'); the reply { type: 'perigee:v1', id: 1, ok: true, result: { dataUrl } } carries a PNG.",
          methods: ['get', 'set', 'snapshot', 'ping'],
          events: ['ready', 'view', 'selection', 'time'],
          documentation: new URL('api/interface.json', engine.data.baseUrl).href,
        },
        note: 'Pictures of the 3D view are taken by the browser showing the embed (snapshot); the server cannot render them.',
      });
    }),
  );

  server.registerTool(
    'perigee_define',
    {
      title: 'Define a term',
      description:
        'Student-level definitions (secondary school) of the terms shown in Perigee: NORAD number, COSPAR id, apogee and perigee, inclination, orbital period, element epoch, ephemeris window, phase… Without a term, lists them all.',
      inputSchema: { term: z.string().max(60).optional(), lang },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(({ term, lang: l }) => json({ definitions: engine.define(term, l ?? 'en') })),
  );

  server.registerTool(
    'perigee_about',
    {
      title: 'Sources, models and accuracy',
      description:
        'What every answer rests on: data sources and when they were fetched, the models and their typical accuracy, catalogue sizes, frame, attribution and the educational-use disclaimer.',
      annotations: readOnly,
    },
    guard(async () => json(await engine.about())),
  );

  return server;
}
