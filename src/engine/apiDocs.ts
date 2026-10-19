/**
 * Static machine documentation (machine interface, phase 3), written at build time by the Vite plugin in
 * vite.config.ts and served under `<site>/api/` and `<site>/llms-full.txt`: the curated catalogues with their
 * goals, status, sources and verification dates, the images with credits and licences, the glossary, and a
 * description of the URL parameters, the embed API and the models' accuracy. No positions: those are computed by
 * the app, the embed API or the engine from the data in `<site>/data/manifest.json`.
 */
import { PLANETS } from '../astro/planets';
import { LICENCES } from '../data/licences';
import { en, fr } from '../i18n';
import { GLOSSARY, LABEL_TERMS, type GlossaryTerm } from '../i18n/glossary';
import { MAX_ABS_RATE, VIEW_IDS } from '../app/urlState';
import { EMBED_PROTOCOL } from '../app/embedApi';
import { Engine } from './index';
import { PublishedData } from './data';
import { catalogs, imageOf, resolve } from './objects';
import { ACCURACY, DISCLAIMER } from './provenance';

export interface BuildInfo {
  readonly version: string;
  readonly commit: string;
  /** Commit date (ISO). */
  readonly date: string;
}

type Bilingual = { readonly en: string; readonly fr: string };

/** Drops the fields that only matter to the renderer (colours, sampling, orbital elements, shape grids). */
function omit<T extends object>(o: T, keys: readonly string[]): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) as Partial<T>;
}

const DATA_STATES: Record<string, string> = {
  fresh: 'Propagated from recent orbital elements.',
  interpolated: 'Interpolated between published ephemeris samples (inside their window).',
  stale: 'Orbital elements older than 14 days: the position may be off by tens to hundreds of kilometres.',
  extrapolated: 'Beyond the published ephemeris window: two-body extrapolation, increasingly approximate.',
  hidden: 'Too far beyond the ephemeris window (7 days for low orbiters, 14 otherwise): no position given.',
  modelled: 'From mean orbital elements (moons), not from an ephemeris of the day.',
  none: 'No public ephemeris: the object is listed but has no position.',
};

/** Everything the documents need, computed once. */
function build(site: string, info: BuildInfo) {
  const engine = new Engine(new PublishedData({ baseUrl: site }));
  const link = (id: string): { view: string; embed: string } => ({
    view: engine.viewUrl(id),
    embed: engine.viewUrl(id, { embed: true }),
  });
  const image = (id: string): { image: { id: string; url: string } } | Record<string, never> => {
    const img = imageOf(resolve(id));
    return img ? { image: { id: img.id, url: `${site}images/${img.id}.webp` } } : {};
  };
  const entry = (id: string, kind: string, fields: object): Record<string, unknown> => ({
    id,
    kind,
    ...fields,
    ...link(id),
    ...image(id),
  });

  const objects = [
    entry('sun', 'sun', { name: { en: 'Sun', fr: 'Soleil' } }),
    ...PLANETS.map((p) =>
      entry(p.id, p.dwarf ? 'dwarf-planet' : 'planet', {
        name: p.name,
        radiusKm: p.radiusKm,
        ...(p.radiiKm ? { radiiKm: p.radiiKm } : {}),
        orbitalPeriodDays: p.periodDays,
        gmKm3S2: p.gmKm3S2,
      }),
    ),
    ...catalogs.moons.map((m) =>
      entry(`moon:${m.id}`, 'moon', omit(m, ['id', 'color', 'elements', 'shape'])),
    ),
    ...catalogs.missions.map((m) => entry(m.id, 'mission', omit(m, ['id', 'color', 'sampling']))),
    ...catalogs.science.map((s) => entry(String(s.norad), 'satellite', omit(s, ['id']))),
    ...catalogs.moonSites.map((s) => entry(`site:${s.id}`, 'site', { body: 'moon', ...omit(s, ['id']) })),
    ...catalogs.marsSites.map((s) =>
      entry(`site:${s.id}`, 'site', { body: 'mars', ...omit(s, ['id', 'feed']) }),
    ),
    ...catalogs.launchSites.map((s) => entry(`launch:${s.id}`, 'launch-site', omit(s, ['id']))),
    ...catalogs.stars.map((s) => {
      const { kind: starType, ...rest } = omit(s, ['id']);
      return entry(`star:${s.id}`, 'star', { ...rest, starType });
    }),
  ];

  const images = catalogs.images.map((i) => ({
    id: i.id,
    target: i.target,
    kind: i.kind,
    url: `${site}images/${i.id}.webp`,
    large: `${site}images/${i.id}-large.webp`,
    credit: i.credit,
    licence: LICENCES[i.licence].name,
    licenceUrl: LICENCES[i.licence].url,
    original: i.file,
    sources: i.sources,
    verified: i.verified,
  }));

  const glossary = (Object.keys(GLOSSARY) as GlossaryTerm[]).map((term) => {
    const keys = Object.entries(LABEL_TERMS)
      .filter(([, t]) => t === term)
      .map(([k]) => k as keyof typeof en);
    const labels = (m: Record<string, string>): string[] => [...new Set(keys.map((k) => m[k] ?? ''))];
    return { term, labels: { en: labels(en), fr: labels(fr) }, definition: GLOSSARY[term] as Bilingual };
  });

  const header = {
    site,
    version: info.version,
    commit: info.commit,
    builtFrom: info.date,
    licence: 'Code MIT; catalogue texts written for Perigee; images under the licence named on each.',
    disclaimer: DISCLAIMER,
  };
  return { engine, objects, images, glossary, header };
}

const SET_PARAMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    view: { enum: [...VIEW_IDS] },
    sel: {
      type: ['string', 'null'],
      description: 'Object id as in the `sel` URL parameter; null clears it.',
    },
    time: { type: 'string', description: 'ISO 8601 UTC instant, or "now" for real time.' },
    rate: { type: 'number', minimum: -MAX_ABS_RATE, maximum: MAX_ABS_RATE, description: '0 pauses.' },
    frame: { enum: ['fixed', 'inertial'] },
    lang: { enum: ['en', 'fr'] },
    follow: { type: 'boolean' },
  },
};

function interfaceDoc(site: string, header: object): object {
  return {
    ...header,
    description:
      'How machines (AI assistants, lesson pages) can use Perigee: links into the app, embed mode with a postMessage API, static catalogue documents, and the published data. Positions are computed by the client from the published data; nothing is computed on a server, and the providers (CelesTrak, JPL Horizons) are never contacted by clients.',
    mcp: {
      hosted: 'https://perigee-mcp.perigeeinfo.workers.dev/mcp',
      transport: 'Streamable HTTP, stateless; no account; 60 requests per minute per address',
      local: 'npx -y perigee-mcp (stdio, Node.js 20+)',
      npm: 'https://www.npmjs.com/package/perigee-mcp',
      tools: [
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
      ],
    },
    documents: {
      catalog: `${site}api/catalog.json`,
      images: `${site}api/images.json`,
      glossary: `${site}api/glossary.json`,
      interface: `${site}api/interface.json`,
      llms: `${site}llms.txt`,
      llmsFull: `${site}llms-full.txt`,
      dataManifest: `${site}data/manifest.json`,
    },
    ids: {
      description:
        'Object ids, shared by the URL `sel` parameter, the embed API and the catalogue: a NORAD catalogue number ("25544"), a mission id ("lro"), a planet or dwarf planet id ("mars", "ceres"), "sun", "moon:<id>" for moons ("moon:titan"; "moon" alone in the Earth view), "site:<id>" for Moon and Mars landing sites, "launch:<id>" for launch sites (written "site:<id>" in the Earth view URL), "star:<id>" for named stars. The `view` and `embed` links of each catalogue object open it.',
    },
    url: {
      base: site,
      parameters: {
        view: { values: [...VIEW_IDS], default: 'earth' },
        lang: { values: ['en', 'fr'], default: 'browser language' },
        sel: { description: 'Selected object id (see ids).' },
        t: {
          description: 'Simulation instant, ISO 8601 UTC (e.g. 2026-12-01T00:00:00Z); real time if absent.',
        },
        rate: {
          description: `Time multiplier (0 pauses, negative runs backwards, |rate| ≤ ${MAX_ABS_RATE}).`,
        },
        frame: {
          values: ['fixed', 'inertial'],
          default: 'fixed',
          description: 'Body-fixed or inertial frame.',
        },
        follow: { values: ['1'], description: 'Follow the selected object.' },
        stars: { values: ['1'], description: 'Name the bright stars (solar view).' },
        embed: { values: ['1'], description: 'Embed mode: the 3D view alone, with a link to the full app.' },
        ui: {
          values: ['panel', 'time', 'panel,time'],
          description: 'In embed mode, keep the information panel and/or the time bar.',
        },
      },
      example: `${site}?embed=1&lang=en&view=solar&sel=mars&follow=1&t=2026-12-01T00:00:00Z&rate=0`,
    },
    embed: {
      iframe: `<iframe src="${site}?embed=1&lang=en&view=solar&sel=mars&follow=1" width="800" height="500" style="border:0" allow="fullscreen" title="Perigee: Mars"></iframe>`,
      protocol: EMBED_PROTOCOL,
      transport:
        'window.postMessage to the iframe, from any origin; replies go to the caller (its origin), events to the parent page.',
      request: {
        type: EMBED_PROTOCOL,
        id: 'any value echoed in the reply',
        method: 'string',
        params: 'object',
      },
      reply: {
        type: EMBED_PROTOCOL,
        id: 'the request id',
        ok: 'boolean',
        result: 'on success',
        error: 'message',
      },
      methods: {
        ping: { result: { protocol: EMBED_PROTOCOL } },
        get: {
          params: {
            details: 'boolean (optional): add the selected object facts and position with provenance',
          },
          result:
            'state: view, sel, time (ISO UTC), live, rate, frame, lang, following, url (same view in the full app); details: { id, facts, position }',
        },
        set: { params: SET_PARAMS_SCHEMA, result: 'the new state' },
        snapshot: {
          params: {
            kind: "'shown' (as displayed, with labels; default) or 'objects' (bodies and spacecraft only)",
          },
          result: '{ dataUrl (PNG data URL), title, kind, mimeType, state }',
        },
      },
      events: {
        ready: 'the first view has loaded (data: state)',
        view: 'the view changed',
        selection: 'the selection changed',
        time: 'the time, rate or real-time mode changed',
      },
    },
    provenance: {
      description:
        'Every computed position states how it was obtained: model, method, data state, sources, dataFetchedAt (when the pipeline downloaded the data), elementEpoch and elementAgeDays (Earth satellites; negative when fitted to a predicted ephemeris), validFrom/validTo and hoursBeyondWindow (ephemerides), and a typical accuracy with its basis.',
      states: DATA_STATES,
      models: ACCURACY,
      frame: 'ICRF/J2000 equatorial (EQJ), km and km/s; distances centre to centre.',
    },
    freshness:
      'data/manifest.json lists each dataset with fetchedAt (UTC) and its hash. CelesTrak elements are refreshed every 4 hours, SATCAT and JPL Horizons ephemerides daily; catalogue entries carry a `verified` date (missions re-checked about monthly).',
    attribution:
      'CelesTrak (T.S. Kelso) / 18th & 19th SDS via Space-Track, NASA/JPL-Caltech Horizons, NASA SVS, USGS Astrogeology, NASA Blue Marble, astronomy-engine (MIT), satellite.js (MIT). Images: credit and licence on each (api/images.json).',
  };
}

/** Plain-text version of the catalogue for language models (llms-full.txt), in English. */
function fullText(site: string, b: ReturnType<typeof build>, llms: string): string {
  const lines: string[] = [llms.trimEnd(), '', '# Full catalogue (generated)', ''];
  lines.push(
    `Generated from Perigee ${b.header.version} (${b.header.commit}). Machine-readable versions: ${site}api/catalog.json, ${site}api/glossary.json, ${site}api/interface.json. ${DISCLAIMER}`,
    '',
  );
  const en_ = (v: unknown): string | undefined =>
    typeof v === 'object' && v !== null && 'en' in v ? String((v as Bilingual).en) : undefined;
  const section = (title: string, kinds: string[]): void => {
    lines.push(`## ${title}`, '');
    for (const o of b.objects.filter((x) => kinds.includes(String(x['kind'])))) {
      const facts = [
        o['agency'] && `agency ${String(o['agency'])}`,
        o['country'] && `country ${String(o['country'])}`,
        o['launchDate'] && `launched ${String(o['launchDate'])}`,
        o['date'] && `date ${String(o['date'])}`,
        o['type'] && `type ${String(o['type'])}`,
        o['status'] && `status ${String(o['status'])}`,
        o['centralBody'] && `around ${String(o['centralBody'])}`,
        o['latDeg'] !== undefined && `lat ${String(o['latDeg'])}°, lon ${String(o['lonDeg'])}°`,
        o['horizonsId'] && `Horizons ${String(o['horizonsId'])}`,
        o['norad'] && `NORAD ${String(o['norad'])}`,
        o['verified'] && `verified ${String(o['verified'])}`,
      ].filter(Boolean);
      lines.push(`### ${en_(o['name']) ?? String(o['id'])} (id \`${String(o['id'])}\`)`);
      if (facts.length) lines.push(facts.join(' · '));
      for (const key of ['purpose', 'goals', 'orbit', 'notes', 'note']) {
        const text = en_(o[key]);
        if (text) lines.push(`${key[0]?.toUpperCase()}${key.slice(1)}: ${text}`);
      }
      const website = o['website'] as { url?: string } | undefined;
      if (website?.url) lines.push(`Website: ${website.url}`);
      const sources = o['sources'] as string[] | undefined;
      if (sources?.length) lines.push(`Sources: ${sources.join(', ')}`);
      lines.push(`View: ${String(o['view'])}`, '');
    }
  };
  section('Missions beyond Earth orbit', ['mission']);
  section('Featured Earth science satellites', ['satellite']);
  section('Landing and impact sites (Moon, Mars)', ['site']);
  section('Launch sites', ['launch-site']);
  lines.push('## Glossary', '');
  for (const g of b.glossary) lines.push(`- **${g.labels.en.join(' / ') || g.term}**: ${g.definition.en}`);
  lines.push('');
  return lines.join('\n');
}

/** The generated files, by path relative to the site root. `llms` is the hand-written public/llms.txt. */
export function buildApiDocuments(site: string, info: BuildInfo, llms: string): Record<string, string> {
  const b = build(site, info);
  const json = (o: unknown): string => `${JSON.stringify(o, null, 1)}\n`;
  return {
    'api/catalog.json': json({ ...b.header, count: b.objects.length, objects: b.objects }),
    'api/images.json': json({ ...b.header, count: b.images.length, images: b.images }),
    'api/glossary.json': json({ ...b.header, count: b.glossary.length, terms: b.glossary }),
    'api/interface.json': json(interfaceDoc(site, b.header)),
    'llms-full.txt': fullText(site, b, llms),
  };
}
