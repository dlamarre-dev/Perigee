/**
 * Perigee's headless engine (machine interface, phase 1): the same models as the app, without DOM or WebGL, for
 * the embed API, the MCP servers and the docs. Every computed answer carries its provenance (model, sources, data
 * fetch time, element age, validity window, typical accuracy) and the educational-use disclaimer.
 *
 *   const engine = createEngine();            // reads https://perigee.info/data/…
 *   await engine.distance('earth', 'mars', new Date('2026-12-01T00:00:00Z'));
 */
import { MOON_RADIUS_KM } from '../astro/bodies';
import { AU_KM } from '../astro/constants';
import { SUN_RADIUS_KM } from '../astro/planets';
import { length, sub, type Vec3 } from '../astro/vec3';
import { en, fr } from '../i18n';
import { GLOSSARY, LABEL_TERMS, type GlossaryTerm } from '../i18n/glossary';
import { PublishedData, type DataOptions } from './data';
import {
  catalogs,
  findInCatalogs,
  imageOf,
  resolve,
  viewOf,
  type FoundObject,
  type ObjectRef,
} from './objects';
import { ACCURACY, DISCLAIMER, type Provenance } from './provenance';
import { helioState } from './state';

export { DISCLAIMER, ACCURACY };
export type { Provenance, FoundObject, ObjectRef };

const LIGHT_SPEED_KM_S = 299_792.458;
type Lang = 'en' | 'fr';

export interface StateAnswer {
  readonly id: string;
  readonly date: string;
  /** Reference point of the position: an engine id ("earth", "moon:moon", "mars", "sun"…). */
  readonly centre: string;
  /** Position relative to the centre (EQJ: ICRF/J2000 equator, km) and velocity (km/s); undefined if unknown. */
  readonly positionKm?: Vec3;
  readonly velocityKmS?: Vec3;
  readonly distanceKm?: number;
  readonly distanceAu?: number;
  /** Height above the centre's mean radius (km), when the centre is a body. */
  readonly altitudeKm?: number;
  readonly speedKmS?: number;
  readonly lightTimeS?: number;
  readonly provenance: readonly Provenance[];
  readonly disclaimer: string;
}

export interface DistanceAnswer {
  readonly from: string;
  readonly to: string;
  readonly date: string;
  readonly distanceKm?: number;
  readonly distanceAu?: number;
  readonly lightTimeS?: number;
  readonly provenance: readonly Provenance[];
  readonly disclaimer: string;
}

export interface SeriesAnswer {
  readonly from: string;
  readonly to: string;
  readonly points: readonly { readonly date: string; readonly distanceKm?: number }[];
  /** Smallest and largest sampled distances (the sampling step bounds their precision). */
  readonly closest?: { readonly date: string; readonly distanceKm: number };
  readonly farthest?: { readonly date: string; readonly distanceKm: number };
  readonly provenance: readonly Provenance[];
  readonly disclaimer: string;
}

export interface ViewLinkOptions {
  readonly date?: Date;
  readonly lang?: Lang;
  /** Simulation speed (1 = real time, 0 = paused). */
  readonly rate?: number;
  readonly follow?: boolean;
  /** Embed mode (no bars or panels), for an iframe. */
  readonly embed?: boolean;
}

/** Default reference point of a position: the body an object orbits or stands on. */
function defaultCentre(ref: ObjectRef): string {
  switch (ref.kind) {
    case 'satellite':
    case 'launch':
      return 'earth';
    case 'site':
      return ref.body === 'moon' ? 'moon:moon' : 'mars';
    case 'mission':
      return ref.mission.centralBody === 'moon' ? 'moon:moon' : ref.mission.centralBody;
    case 'moon':
      return ref.moon.id === 'moon' ? 'earth' : ref.moon.planet;
    default:
      return 'sun';
  }
}

/** Mean radius of a body used as a centre (for altitudes), if it is one. */
function radiusOf(ref: ObjectRef): number | undefined {
  if (ref.kind === 'sun') return SUN_RADIUS_KM;
  if (ref.kind === 'planet') return ref.planet.radiusKm;
  if (ref.kind === 'moon') return ref.moon.id === 'moon' ? MOON_RADIUS_KM : ref.moon.radiusKm;
  if (ref.kind === 'mission' && ref.mission.objectType === 'natural') return ref.mission.radiusKm;
  return undefined;
}

function parseDate(date: Date | string | undefined): Date {
  const d = date === undefined ? new Date() : typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${String(date)}`);
  return d;
}

export class Engine {
  constructor(readonly data: PublishedData) {}

  /** Objects whose name or id matches (catalogues, then active satellites by name, NORAD or COSPAR id). */
  async find(query: string, limit = 10): Promise<FoundObject[]> {
    const found = findInCatalogs(query);
    if (found.length < limit && query.trim().length >= 2) {
      const q = query.trim().toUpperCase();
      const { omm } = await this.data.gpElements();
      for (const o of omm) {
        if (found.length >= limit) break;
        if (found.some((f) => f.id === String(o.NORAD_CAT_ID))) continue;
        if (o.OBJECT_NAME.toUpperCase().includes(q) || String(o.NORAD_CAT_ID) === q || o.OBJECT_ID === q)
          found.push({
            id: String(o.NORAD_CAT_ID),
            kind: 'satellite',
            name: { en: o.OBJECT_NAME, fr: o.OBJECT_NAME },
          });
      }
    }
    return found.slice(0, limit);
  }

  /** Facts about an object: names, mission goals and status, identifiers, sources, image, link to its view. */
  async describe(id: string, lang: Lang = 'en'): Promise<Record<string, unknown>> {
    const ref = resolve(id);
    const image = imageOf(ref);
    const base: Record<string, unknown> = {
      id: ref.id,
      kind: ref.kind,
      view: this.viewUrl(ref.id, { lang }),
      embed: this.viewUrl(ref.id, { lang, embed: true }),
      ...(image
        ? {
            image: {
              url: `${this.data.baseUrl}images/${image.id}.webp`,
              large: `${this.data.baseUrl}images/${image.id}-large.webp`,
              kind: image.kind,
              credit: image.credit,
              licence: image.licence,
              source: image.sources[0],
            },
          }
        : {}),
    };
    const localized = (v: { en: string; fr: string } | undefined): string | undefined => v?.[lang];
    switch (ref.kind) {
      case 'mission': {
        const m = ref.mission;
        return {
          ...base,
          name: m.name[lang],
          agency: m.agency,
          country: m.country,
          launchDate: m.launchDate,
          centralBody: m.centralBody,
          status: m.status,
          orbit: localized(m.orbit),
          goals: localized(m.goals),
          notes: localized(m.notes),
          website: m.website,
          horizonsId: m.horizonsId,
          norad: m.norad,
          ephemeris: m.ephemeris,
          verified: m.verified,
          sources: m.sources,
        };
      }
      case 'satellite': {
        const [{ omm, entry }, satcat] = await Promise.all([
          this.data.gpElements(),
          this.data.satcatRecords(),
        ]);
        const o = omm.find((x) => x.NORAD_CAT_ID === ref.norad);
        const sc = satcat?.records.find((r) => r.NORAD_CAT_ID === ref.norad);
        const c = ref.curated;
        return {
          ...base,
          name: c?.name[lang] ?? o?.OBJECT_NAME ?? sc?.OBJECT_NAME,
          norad: ref.norad,
          cospar: o?.OBJECT_ID ?? sc?.OBJECT_ID,
          owner: sc?.OWNER,
          launchDate: sc?.LAUNCH_DATE ?? c?.launchDate,
          launchSite: sc?.LAUNCH_SITE,
          objectType: sc?.OBJECT_TYPE,
          status: c?.status ?? sc?.OPS_STATUS_CODE,
          purpose: localized(c?.purpose),
          goals: localized(c?.goals),
          notes: localized(c?.notes),
          website: c?.website,
          elementEpoch: o ? new Date(Date.parse(`${o.EPOCH}Z`)).toISOString() : undefined,
          elementsSource: o?.SOURCE ? `CelesTrak SupGP (${o.SOURCE})` : 'CelesTrak GP',
          dataFetchedAt: entry.fetchedAt,
          active: o !== undefined,
          sources: c?.sources ?? ['https://celestrak.org'],
        };
      }
      case 'moon':
        return {
          ...base,
          name: ref.moon.name[lang],
          planet: ref.moon.planet,
          radiusKm: ref.moon.radiusKm,
          model: ref.moon.model,
          notes: localized(ref.moon.notes),
          sources: ref.moon.sources,
        };
      case 'planet':
        return {
          ...base,
          name: ref.planet.name[lang],
          radiusKm: ref.planet.radiusKm,
          orbitalPeriodDays: ref.planet.periodDays,
          dwarf: ref.planet.dwarf ?? false,
          sources: [
            'https://github.com/cosinekitty/astronomy',
            'https://nssdc.gsfc.nasa.gov/planetary/factsheet/',
          ],
        };
      case 'site':
        return {
          ...base,
          name: ref.site.name[lang],
          body: ref.body,
          type: ref.site.type,
          date: ref.site.date,
          agency: ref.site.agency,
          country: ref.site.country,
          latDeg: ref.site.latDeg,
          lonDeg: ref.site.lonDeg,
          note: localized(ref.site.note),
          sources: ref.site.sources,
        };
      case 'launch':
        return {
          ...base,
          name: ref.site.name[lang],
          operator: ref.site.operator,
          country: ref.site.country,
          latDeg: ref.site.latDeg,
          lonDeg: ref.site.lonDeg,
          firstOrbitalLaunch: ref.site.firstOrbitalLaunch,
          active: ref.site.active,
          satcatCodes: ref.site.satcatCodes,
          sources: ref.site.sources,
        };
      case 'star':
        return {
          ...base,
          name: ref.star.name[lang],
          designation: ref.star.designation,
          constellation: ref.star.constellation[lang],
          spectralType: ref.star.spectralType,
          magnitude: ref.star.magnitude,
          distanceLy: ref.star.distanceLy,
          raDeg: ref.star.raDeg,
          decDeg: ref.star.decDeg,
          notes: localized(ref.star.notes),
          sources: ref.star.sources,
        };
      case 'sun':
        return {
          ...base,
          name: lang === 'fr' ? 'Soleil' : 'Sun',
          radiusKm: SUN_RADIUS_KM,
          sources: ['https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html'],
        };
    }
  }

  /** Position and velocity of an object relative to a centre (default: the body it orbits or stands on). */
  async state(id: string, date?: Date | string, centre?: string): Promise<StateAnswer> {
    const when = parseDate(date);
    const ref = resolve(id);
    const centreRef = resolve(centre ?? defaultCentre(ref));
    const [a, c] = await Promise.all([
      helioState(ref, when, this.data),
      helioState(centreRef, when, this.data),
    ]);
    // Around its own centre an object's position is computed relative to it: the centre's model cancels out.
    const ownCentre = centreRef.kind === 'sun' || centreRef.id === resolve(defaultCentre(ref)).id;
    const provenance = ownCentre ? [a.provenance] : [a.provenance, c.provenance];
    const answer = {
      id: ref.id,
      date: when.toISOString(),
      centre: centreRef.id,
      provenance,
      disclaimer: DISCLAIMER,
    };
    if (!a.state || !c.state) return answer;
    const rel = sub(a.state.posKm, c.state.posKm);
    const vel = sub(a.state.velKmS, c.state.velKmS);
    const distanceKm = length(rel);
    const radius = radiusOf(centreRef);
    return {
      ...answer,
      positionKm: rel,
      velocityKmS: vel,
      distanceKm,
      distanceAu: distanceKm / AU_KM,
      ...(radius !== undefined ? { altitudeKm: distanceKm - radius } : {}),
      speedKmS: length(vel),
      lightTimeS: distanceKm / LIGHT_SPEED_KM_S,
    };
  }

  /** Distance between two objects (centre to centre) at a date, with the light time. */
  async distance(fromId: string, toId: string, date?: Date | string): Promise<DistanceAnswer> {
    const when = parseDate(date);
    const [from, to] = [resolve(fromId), resolve(toId)];
    const [a, b] = await Promise.all([helioState(from, when, this.data), helioState(to, when, this.data)]);
    const answer = {
      from: from.id,
      to: to.id,
      date: when.toISOString(),
      provenance: [a.provenance, b.provenance],
      disclaimer: DISCLAIMER,
    };
    if (!a.state || !b.state) return answer;
    const distanceKm = length(sub(a.state.posKm, b.state.posKm));
    return {
      ...answer,
      distanceKm,
      distanceAu: distanceKm / AU_KM,
      lightTimeS: distanceKm / LIGHT_SPEED_KM_S,
    };
  }

  /** Distances sampled over a period (at most 1000 points), with the closest and farthest samples. */
  async series(
    fromId: string,
    toId: string,
    start: Date | string,
    end: Date | string,
    steps = 50,
  ): Promise<SeriesAnswer> {
    const t0 = parseDate(start).getTime();
    const t1 = parseDate(end).getTime();
    const n = Math.max(1, Math.min(1000, Math.round(steps)));
    const points: { date: string; distanceKm?: number }[] = [];
    let provenance: readonly Provenance[] = [];
    for (let i = 0; i <= n; i++) {
      const d = await this.distance(fromId, toId, new Date(t0 + ((t1 - t0) * i) / n));
      if (i === 0 || i === n) provenance = [...provenance, ...d.provenance];
      points.push({ date: d.date, ...(d.distanceKm !== undefined ? { distanceKm: d.distanceKm } : {}) });
    }
    const known = points.filter((p): p is { date: string; distanceKm: number } => p.distanceKm !== undefined);
    const pick = (
      better: (a: number, b: number) => boolean,
    ): { date: string; distanceKm: number } | undefined =>
      known.reduce<{ date: string; distanceKm: number } | undefined>(
        (best, p) => (!best || better(p.distanceKm, best.distanceKm) ? p : best),
        undefined,
      );
    const closest = pick((a, b) => a < b);
    const farthest = pick((a, b) => a > b);
    return {
      from: resolve(fromId).id,
      to: resolve(toId).id,
      points,
      ...(closest ? { closest } : {}),
      ...(farthest ? { farthest } : {}),
      provenance,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Student-level definitions (EN/FR) of the terms shown in Perigee's panels, with the panel labels they explain;
   * all of them without a term. Matches the term id or a label, ignoring case and accents.
   */
  define(term?: string, lang: Lang = 'en'): { term: string; labels: string[]; definition: string }[] {
    const messages = lang === 'fr' ? fr : en;
    const fold = (s: string): string =>
      s
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
    const entries = (Object.keys(GLOSSARY) as GlossaryTerm[]).map((t) => {
      const keys = Object.entries(LABEL_TERMS)
        .filter(([, v]) => v === t)
        .map(([k]) => k as keyof typeof en);
      return {
        term: t,
        labels: [...new Set(keys.map((k) => messages[k]))],
        all: [t, ...keys.flatMap((k) => [en[k], fr[k]])].map(fold),
        definition: GLOSSARY[t][lang],
      };
    });
    const q = term ? fold(term.trim()) : '';
    return entries.filter((e) => !q || e.all.some((s) => s.includes(q))).map(({ all: _all, ...e }) => e);
  }

  /** Link to the view showing an object (optionally at a date, followed, embedded). */
  viewUrl(id: string, options: ViewLinkOptions = {}): string {
    const { view, sel } = viewOf(resolve(id));
    const p = new URLSearchParams();
    if (view !== 'earth') p.set('view', view);
    p.set('sel', sel);
    if (options.lang) p.set('lang', options.lang);
    if (options.date) p.set('t', options.date.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    if (options.rate !== undefined && options.rate !== 1) p.set('rate', String(options.rate));
    if (options.follow) p.set('follow', '1');
    if (options.embed) p.set('embed', '1');
    return `${this.data.baseUrl}?${p.toString()}`;
  }

  /** What every answer rests on: sources, models and their typical accuracy, catalogue dates. */
  async about(): Promise<Record<string, unknown>> {
    const manifest = await this.data.manifest().catch(() => undefined);
    return {
      site: this.data.baseUrl,
      dataGeneratedAt: manifest?.generatedAt,
      datasets: manifest
        ? Object.fromEntries(
            Object.entries(manifest.datasets).map(([k, v]) => [
              k,
              { fetchedAt: v.fetchedAt, source: v.source },
            ]),
          )
        : undefined,
      models: ACCURACY,
      catalogues: {
        missions: catalogs.missions.length,
        scienceSatellites: catalogs.science.length,
        landingSites: catalogs.moonSites.length + catalogs.marsSites.length,
        launchSites: catalogs.launchSites.length,
      },
      frame:
        'Positions are in the ICRF/J2000 equatorial frame (EQJ), in km; centres as named in each answer.',
      attribution:
        'CelesTrak (T.S. Kelso) / 18th & 19th SDS via Space-Track, NASA/JPL-Caltech Horizons, astronomy-engine (MIT), satellite.js (MIT); curated catalogues in https://github.com/dlamarre-dev/Perigee/tree/master/catalog',
      disclaimer: DISCLAIMER,
    };
  }
}

export function createEngine(options: DataOptions = {}): Engine {
  return new Engine(new PublishedData(options));
}
