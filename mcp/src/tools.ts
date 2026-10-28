/**
 * Perigee's MCP tools, shared by the local stdio server (./cli.ts) and the hosted endpoint (workers/mcp): thin
 * wrappers over the headless engine (src/engine). Every computed answer carries its provenance (model, sources,
 * fetch time, element age, validity window, data state, typical accuracy) and the educational-use disclaimer.
 * Data come from Perigee's published files (https://perigee.info/data/); CelesTrak and Horizons are never contacted.
 */
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Engine } from '../../src/engine';

export const SERVER_NAME = 'perigee';

export interface ToolOptions {
  /** Version reported to clients. */
  readonly version: string;
  /** Fetches a catalogue image (WebP) for `include_image`; omitted: images are only linked. */
  readonly fetchImage?: (url: string) => Promise<Uint8Array>;
  /** Most samples of a distance series (default 1000; the hosted endpoint's CPU budget allows fewer). */
  readonly maxSeriesSteps?: number;
  /** Longest pass search, days (default 10; fewer on the hosted endpoint). */
  readonly maxPassDays?: number;
  /** Longest event search, days (default 366; fewer on the hosted endpoint). */
  readonly maxEventDays?: number;
  /** Longest close-approach search, days (default 7; fewer on the hosted endpoint). */
  readonly maxApproachDays?: number;
  /** Longest sky-conjunction search, days (default 31; fewer on the hosted endpoint). */
  readonly maxConjunctionDays?: number;
  /** Longest shadow search, hours (default 48; fewer on the hosted endpoint). */
  readonly maxShadowHours?: number;
  /**
   * Tools switched off (the hosted endpoint's circuit breaker): full names or their ends ("series" for
   * perigee_distance_series). They stay in tools/list marked unavailable, and calls to them get an error that
   * points to the local server.
   */
  readonly disabledTools?: readonly string[];
}

const INSTRUCTIONS = `Perigee (https://perigee.info/) shows in 3D, in real time, the artificial objects orbiting the Earth, the Moon and Mars and the spacecraft crossing the solar system, for education.
Use perigee_find to get an object's id (NORAD number, mission id, planet, "moon:<id>", "site:<id>", "launch:<id>", "star:<id>", "comet:<id>", "asteroid:<id>"; dwarf planets and candidates by name: "eris", "quaoar", "2026-ed138"), then perigee_object for facts (goals, status, sources, an image with its credit), perigee_state (with the ground point below) / perigee_orbit / perigee_distance / perigee_distance_series for computed values, perigee_passes for when a satellite can be seen from a place, perigee_sky for what is in the sky from a place, perigee_tonight for a ready summary of the night ahead from a place, perigee_sky_conjunctions for close pairings of the Moon, planets, bright stars (and a satellite) in the sky, perigee_events for Moon phases, eclipses, oppositions and mission milestones, perigee_shadow for when a satellite enters or leaves the Earth's shadow, perigee_ground_track for the path below a satellite, perigee_close_approach for the closest distance between two objects in space (education only), perigee_stats for counts of active satellites, perigee_view for a link or an embeddable live 3D view (perigee_describe_view puts one into words, e.g. for alternative text), perigee_define for student-level definitions.
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
  // Every tool registered below, so that the disabled ones can be switched off at the end.
  const registered = new Map<string, RegisteredTool>();
  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: unknown,
    cb: unknown,
  ) => RegisteredTool;
  server.registerTool = ((name: string, config: unknown, cb: unknown) => {
    const tool = registerTool(name, config, cb);
    registered.set(name, tool);
    return tool;
  }) as typeof server.registerTool;
  const readOnly = { readOnlyHint: true, openWorldHint: true } as const;
  const maxSteps = options.maxSeriesSteps ?? 1000;
  const maxPassDays = options.maxPassDays ?? 10;
  const maxEventDays = options.maxEventDays ?? 366;
  const maxApproachDays = options.maxApproachDays ?? 7;
  const maxConjunctionDays = options.maxConjunctionDays ?? 31;
  const maxShadowHours = options.maxShadowHours ?? 48;
  const latitude = z.number().min(-90).max(90).describe('Observer latitude, degrees (north positive).');
  const longitude = z.number().min(-180).max(360).describe('Observer longitude, degrees (east positive).');
  const heightM = z.number().min(-500).max(9000).optional().describe('Observer height above sea level, m.');
  const timeZone = z
    .string()
    .max(64)
    .optional()
    .describe('IANA time zone for local times, e.g. "Europe/Paris".');

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
        'Position (km, ICRF/J2000 equatorial axes) and velocity (km/s) of an object at a date, relative to a centre (default: the body it orbits or stands on), with distance, altitude above the centre, speed, light time, whether it is in sunlight, and provenance. Around the Earth, the Moon or Mars it also gives the ground point below it (latitude, longitude; on the Earth the country or sea, e.g. "over Brazil", "over the Indian Ocean").',
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
    'perigee_orbit',
    {
      title: 'Orbit',
      description:
        'Orbit of an object: perigee and apogee altitudes (periapsis/apoapsis), period, inclination, eccentricity, semi-major axis. Earth satellites: the mean elements of their published element set, with the orbit regime (LEO, MEO, GEO, HEO); other objects: instantaneous two-body elements around their centre at a date (default: the body they orbit; inclination on its equator, on the ecliptic around the Sun).',
      inputSchema: {
        id,
        date,
        centre: z
          .string()
          .optional()
          .describe('Body the orbit is around, e.g. "sun" for a planet or a probe.'),
      },
      annotations: readOnly,
    },
    guard(async ({ id: objectId, date: d, centre }) => json(await engine.orbit(objectId, d, centre))),
  );

  server.registerTool(
    'perigee_passes',
    {
      title: 'Satellite passes over a place',
      description: `When an Earth satellite (ISS = 25544, Tiangong = 48274, Hubble = 20580, or any NORAD number) passes over a place: rise, highest point and set times with direction (azimuth, compass point) and elevation, and whether it can be seen with the naked eye (sunlit satellite, dark sky) and when. Give the place's latitude and longitude (degrees, east positive) and, for local times, its IANA time zone. Up to ${maxPassDays} days ahead.`,
      inputSchema: {
        id,
        latitude: z.number().min(-90).max(90).describe('Observer latitude, degrees (north positive).'),
        longitude: z.number().min(-180).max(360).describe('Observer longitude, degrees (east positive).'),
        height_m: z.number().min(-500).max(9000).optional().describe('Observer height above sea level, m.'),
        start: date,
        days: z.number().min(0.05).max(maxPassDays).optional().describe('Search length in days (default 3).'),
        min_elevation: z
          .number()
          .min(0)
          .max(80)
          .optional()
          .describe('Lowest culmination kept and lowest elevation counted as visible, degrees (default 10).'),
        time_zone: z
          .string()
          .max(64)
          .optional()
          .describe('IANA time zone for local times, e.g. "America/Toronto".'),
        lang,
      },
      annotations: readOnly,
    },
    guard(
      async ({
        id: objectId,
        latitude,
        longitude,
        height_m,
        start,
        days,
        min_elevation,
        time_zone,
        lang: l,
      }) =>
        json(
          await engine.passes(
            objectId,
            {
              latDeg: latitude,
              lonDeg: longitude,
              ...(height_m !== undefined ? { heightM: height_m } : {}),
              ...(start ? { start } : {}),
              ...(days !== undefined ? { days } : {}),
              ...(min_elevation !== undefined ? { minElevationDeg: min_elevation } : {}),
              ...(time_zone ? { timeZone: time_zone } : {}),
              lang: l ?? 'en',
            },
            maxPassDays,
          ),
        ),
    ),
  );

  server.registerTool(
    'perigee_sky',
    {
      title: 'The sky from a place',
      description:
        'What is in the sky from a place at a date (default: now): day, twilight or night; the Sun with its next rise, set and twilights; the Moon with its phase, illuminated share, rise and set; each planet with its altitude, direction, brightness (magnitude), constellation and whether it can be seen with the naked eye; and the bright named stars above the horizon. For "what can I see tonight", give the evening time.',
      inputSchema: { latitude, longitude, height_m: heightM, date, time_zone: timeZone, lang },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(({ latitude: lat, longitude: lon, height_m, date: d, time_zone, lang: l }) =>
      json(
        engine.sky({
          latDeg: lat,
          lonDeg: lon,
          ...(height_m !== undefined ? { heightM: height_m } : {}),
          ...(d ? { date: d } : {}),
          ...(time_zone ? { timeZone: time_zone } : {}),
          lang: l ?? 'en',
        }),
      ),
    ),
  );

  server.registerTool(
    'perigee_events',
    {
      title: 'Astronomical and mission events',
      description: `Events over a period (default: the next 30 days, at most ${maxEventDays}): Moon phases (super and micro full Moons), lunar perigee and apogee, lunar and solar eclipses (with a place: how they look from there), equinoxes and solstices, the Earth's perihelion and aphelion, planet oppositions, conjunctions and greatest elongations, and the next key events of the missions (flybys, arrivals, launches) from Perigee's catalogue.`,
      inputSchema: {
        start: date,
        days: z
          .number()
          .min(1)
          .max(maxEventDays)
          .optional()
          .describe('Length of the period in days (default 30).'),
        kinds: z
          .array(z.enum(['moon', 'eclipse', 'season', 'planet', 'mission']))
          .optional()
          .describe('Kinds of events to include (default: all).'),
        latitude: latitude.optional(),
        longitude: longitude.optional(),
        time_zone: timeZone,
        lang,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(({ start, days, kinds, latitude: lat, longitude: lon, time_zone, lang: l }) => {
      if ((lat === undefined) !== (lon === undefined))
        throw new Error('Give both latitude and longitude, or neither.');
      return json(
        engine.events(
          {
            ...(start ? { start } : {}),
            ...(days !== undefined ? { days } : {}),
            ...(kinds ? { kinds } : {}),
            lang: l ?? 'en',
            ...(lat !== undefined && lon !== undefined
              ? { place: { latDeg: lat, lonDeg: lon, ...(time_zone ? { timeZone: time_zone } : {}) } }
              : {}),
          },
          maxEventDays,
        ),
      );
    }),
  );

  server.registerTool(
    'perigee_tonight',
    {
      title: 'Tonight from a place',
      description:
        "What there is to see tonight from a place (the coming night, or the current one): the night's start and end, the Moon (phase, illuminated share, rise and set), the planets visible to the naked eye, the visible passes of the ISS, Tiangong and Hubble, the close pairings of the Moon and planets, and the sky's events of the night, with short highlights ready to read. Give the place's latitude and longitude and, for local times, its IANA time zone.",
      inputSchema: { latitude, longitude, height_m: heightM, date, time_zone: timeZone, lang },
      annotations: readOnly,
    },
    guard(async ({ latitude: lat, longitude: lon, height_m, date: d, time_zone, lang: l }) =>
      json(
        await engine.tonight({
          latDeg: lat,
          lonDeg: lon,
          ...(height_m !== undefined ? { heightM: height_m } : {}),
          ...(d ? { date: d } : {}),
          ...(time_zone ? { timeZone: time_zone } : {}),
          lang: l ?? 'en',
        }),
      ),
    ),
  );

  server.registerTool(
    'perigee_sky_conjunctions',
    {
      title: 'Close pairings in the sky',
      description: `Apparent close pairings seen from a place over a period (default 7 days, at most ${maxConjunctionDays}): the Moon and the planets with each other and with the bright stars near the ecliptic (Regulus, Spica, Antares, Aldebaran, Pollux…), at their closest, with where to look and whether the pair is visible (above the horizon, dark sky). With \`satellite\` (a NORAD number), that satellite passing near them during its passes over one day.`,
      inputSchema: {
        latitude,
        longitude,
        height_m: heightM,
        start: date,
        days: z
          .number()
          .min(0.05)
          .max(maxConjunctionDays)
          .optional()
          .describe('Length of the period in days (default 7; 1 with a satellite).'),
        max_separation: z
          .number()
          .min(0.1)
          .max(10)
          .optional()
          .describe('Widest separation kept, degrees (default 5).'),
        satellite: z
          .string()
          .max(20)
          .optional()
          .describe('An Earth satellite (NORAD number) to check against the Moon, planets and stars.'),
        time_zone: timeZone,
        lang,
      },
      annotations: readOnly,
    },
    guard(
      async ({
        latitude: lat,
        longitude: lon,
        height_m,
        start,
        days,
        max_separation,
        satellite,
        time_zone,
        lang: l,
      }) =>
        json(
          await engine.skyConjunctions(
            {
              latDeg: lat,
              lonDeg: lon,
              ...(height_m !== undefined ? { heightM: height_m } : {}),
              ...(start ? { start } : {}),
              ...(days !== undefined ? { days } : {}),
              ...(max_separation !== undefined ? { maxSeparationDeg: max_separation } : {}),
              ...(satellite ? { satellite } : {}),
              ...(time_zone ? { timeZone: time_zone } : {}),
              lang: l ?? 'en',
            },
            maxConjunctionDays,
          ),
        ),
    ),
  );

  server.registerTool(
    'perigee_shadow',
    {
      title: 'Sunlight and shadow',
      description: `Whether an object is in sunlight, in the penumbra or in the umbra of the body it orbits (Earth satellites: the Earth's shadow; lunar and Martian orbiters: the Moon's or Mars'), and when it next enters and leaves the shadow (default: over two orbits, at most ${maxShadowHours} hours). Explains why a satellite crossing the night sky suddenly fades out.`,
      inputSchema: {
        id,
        date,
        hours: z
          .number()
          .min(0.1)
          .max(maxShadowHours)
          .optional()
          .describe('Length of the search in hours (default: two orbits).'),
        centre: z
          .string()
          .optional()
          .describe('Body casting the shadow (default: the one the object orbits).'),
        time_zone: timeZone,
        lang,
      },
      annotations: readOnly,
    },
    guard(async ({ id: objectId, date: d, hours, centre, time_zone, lang: l }) =>
      json(
        await engine.shadow(
          objectId,
          {
            ...(d ? { date: d } : {}),
            ...(hours !== undefined ? { hours } : {}),
            ...(centre ? { centre } : {}),
            ...(time_zone ? { timeZone: time_zone } : {}),
            lang: l ?? 'en',
          },
          maxShadowHours,
        ),
      ),
    ),
  );

  server.registerTool(
    'perigee_ground_track',
    {
      title: 'Ground track',
      description:
        'The path on the ground below an Earth satellite over one or two orbits: a list of points (time, latitude, longitude, height) and a GeoJSON MultiLineString split at the antimeridian, ready for a map. Up to 360 points.',
      inputSchema: {
        id,
        start: date,
        orbits: z.number().min(0.1).max(2).optional().describe('Number of orbits (default 1).'),
        points: z
          .number()
          .int()
          .min(10)
          .max(360)
          .optional()
          .describe('Number of points (default 180 per orbit).'),
        lang,
      },
      annotations: readOnly,
    },
    guard(async ({ id: objectId, start, orbits, points, lang: l }) =>
      json(
        await engine.groundTrack(objectId, {
          ...(start ? { start } : {}),
          ...(orbits !== undefined ? { orbits } : {}),
          ...(points !== undefined ? { points } : {}),
          lang: l ?? 'en',
        }),
      ),
    ),
  );

  server.registerTool(
    'perigee_close_approach',
    {
      title: 'Closest approach in space',
      description: `The closest distance between two objects in space over a period (default 1 day, at most ${maxApproachDays}): when, how close (timed to a fraction of a second) and, for two Earth satellites, how fast they pass each other. For education only: public orbits are not precise enough for collision avoidance, and the answer says so.`,
      inputSchema: {
        from: id.describe('First object id.'),
        to: id.describe('Second object id.'),
        start: date,
        days: z
          .number()
          .min(0.01)
          .max(maxApproachDays)
          .optional()
          .describe('Length of the search in days (default 1).'),
        time_zone: timeZone,
        lang,
      },
      annotations: readOnly,
    },
    guard(async ({ from, to, start, days, time_zone, lang: l }) =>
      json(
        await engine.closeApproach(
          from,
          to,
          {
            ...(start ? { start } : {}),
            ...(days !== undefined ? { days } : {}),
            ...(time_zone ? { timeZone: time_zone } : {}),
            lang: l ?? 'en',
          },
          maxApproachDays,
        ),
      ),
    ),
  );

  server.registerTool(
    'perigee_stats',
    {
      title: 'Satellite statistics',
      description:
        'Counts of the active satellites: total, by owner (country or organisation, e.g. US, PRC, CIS, ESA), by operator (SpaceX, OneWeb, Amazon Kuiper…), by CelesTrak group (constellations, navigation, weather…), by orbit regime (LEO, MEO, GEO, HEO), object type, launch year, recent launches and low-orbit altitude bands. owner, operator or group narrow a list to matching entries (code or name).',
      inputSchema: {
        owner: z.string().max(60).optional(),
        operator: z.string().max(60).optional(),
        group: z.string().max(60).optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Largest entries listed per category (default 25).'),
        lang,
      },
      annotations: readOnly,
    },
    guard(async ({ owner, operator, group, limit, lang: l }) =>
      json(
        await engine.stats({
          lang: l ?? 'en',
          ...(owner ? { owner } : {}),
          ...(operator ? { operator } : {}),
          ...(group ? { group } : {}),
          ...(limit !== undefined ? { limit } : {}),
        }),
      ),
    ),
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
        steps: z
          .number()
          .int()
          .min(1)
          .max(maxSteps)
          .optional()
          .describe(`Number of intervals (default 50, at most ${maxSteps}).`),
      },
      annotations: readOnly,
    },
    guard(async ({ from, to, start, end, steps }) =>
      json(await engine.series(from, to, start, end, Math.min(steps ?? 50, maxSteps))),
    ),
  );

  server.registerTool(
    'perigee_view',
    {
      title: 'Link or embed a 3D view',
      description:
        'Link to Perigee showing an object (optionally at a date, paused or accelerated, followed), and an iframe snippet for a lesson page: the live 3D view without bars or panels. The embedding page can then drive the view and take PNG snapshots with postMessage (protocol perigee:v1, documented in `embedApi`). For a star, star_map opens its 3D map with the Sun instead (every named star at its real distance, the Sun–star distance drawn; compare adds a second star), alone in the iframe.',
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
        star_map: z
          .boolean()
          .optional()
          .describe("Stars only (star:<id>): open the star's 3D map with the Sun, alone in the embed."),
        compare: id
          .optional()
          .describe('With star_map: another star (star:<id>) drawn with its distance to compare.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(({ id: objectId, date: d, lang: l, rate, follow, panel, time_bar, star_map, compare }) => {
      const when = d ? new Date(d) : undefined;
      if (when && Number.isNaN(when.getTime())) throw new Error(`Invalid date: ${d}`);
      const opts = {
        ...(when ? { date: when } : {}),
        ...(l ? { lang: l } : {}),
        ...(rate !== undefined ? { rate } : {}),
        follow: follow ?? true,
        ...(star_map ? { starMap: true, ...(compare ? { compare } : {}) } : {}),
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
    'perigee_describe_view',
    {
      title: 'Describe a view',
      description:
        'Turns a Perigee link or embed URL (from perigee_view or a shared link) into words: a one-sentence alternative text for the image or iframe, and a description for lesson notes (which view, the selected object, where it is and how reliable its position is, the date and speed of time, the frame, the filters and what is hidden). The camera framing is not in the link.',
      inputSchema: {
        url: z
          .string()
          .min(1)
          .max(2000)
          .describe('A Perigee URL, e.g. https://perigee.info/?view=solar&sel=mars'),
        lang,
        time_zone: timeZone,
      },
      annotations: readOnly,
    },
    guard(async ({ url, lang: l, time_zone }) => json(await engine.describeView(url, l ?? 'en', time_zone))),
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

  // Circuit breaker: switched-off tools stay listed, marked unavailable, and answer with the way out.
  const unavailable =
    'Temporarily unavailable on this server (protection against overload). The same tool works in the local server: npx -y perigee-mcp';
  for (const name of matchTools([...registered.keys()], options.disabledTools ?? [])) {
    const tool = registered.get(name);
    tool?.update({
      description: `[${unavailable}] ${tool.description ?? ''}`,
      callback: (() => failure(new Error(`${name}: ${unavailable}`))) as never,
    });
  }
  return server;
}

/** Tool names matching a list of full names or name ends ("series", "passes"); "*" matches every tool. */
export function matchTools(names: readonly string[], patterns: readonly string[]): string[] {
  const wanted = patterns.map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (wanted.includes('*')) return [...names];
  return names.filter((n) => wanted.some((w) => n === w || n.endsWith(`_${w}`)));
}
