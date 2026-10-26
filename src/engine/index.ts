/**
 * Perigee's headless engine (machine interface, phase 1): the same models as the app, without DOM or WebGL, for
 * the embed API, the MCP servers and the docs. Every computed answer carries its provenance (model, sources, data
 * fetch time, element age, validity window, typical accuracy) and the educational-use disclaimer.
 *
 *   const engine = createEngine();            // reads https://perigee.info/data/…
 *   await engine.distance('earth', 'mars', new Date('2026-12-01T00:00:00Z'));
 */
import { MOON_RADIUS_KM } from '../astro/bodies';
import { AU_KM, EARTH_EQUATORIAL_RADIUS_KM } from '../astro/constants';
import { SUN_RADIUS_KM } from '../astro/planets';
import { add, length, sub, type Vec3 } from '../astro/vec3';
import { en, fr } from '../i18n';
import { GLOSSARY, LABEL_TERMS, type GlossaryTerm } from '../i18n/glossary';
import { LICENCES } from '../data/licences';
import { PublishedData, type DataOptions } from './data';
import {
  catalogs,
  findInCatalogs,
  imageOf,
  resolve,
  sitesByBody,
  viewOf,
  type FoundObject,
  type ObjectRef,
} from './objects';
import { ACCURACY, ASTRONOMY_ENGINE, CELESTRAK, DISCLAIMER, SIMBAD, type Provenance } from './provenance';
import { EVENT_KINDS, eventsBetween, type EventKind } from './events';
import { skyFrom } from './sky';
import { describeView } from './describeView';
import { compassPoint, degrees, radians, round } from './ground';
import {
  groundPoint,
  meanOrbit,
  osculatingOrbit,
  sunlight,
  type GroundPoint,
  type OrbitDescription,
} from './orbitTools';
import { findPasses, sunTeme, type PassPoint } from './passes';
import { earthShadowFraction, lightChanges, lightOf } from './shadow';
import { groundTrackPoints, trackGeoJson } from './groundTrack';
import { closestApproaches } from './closeApproach';
import { skyConjunctions } from './conjunctions';
import { compassLabel, LIGHT_LABELS, NOTES } from './notes';
import { propagateTeme } from '../earth/sgp4';
import * as Astronomy from 'astronomy-engine';
import { localTime } from './timeFormat';
import { helioState, missionTrack, satelliteElementsAt } from './state';
import { utcToTdbJd } from '../astro/time';

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
  /** Surface point below the object, when the centre is the Earth, the Moon or Mars. */
  readonly groundPoint?: GroundPoint;
  /** Share of the Sun's disc seen from the object past the centre body (1 sunlit, 0 in its shadow). */
  readonly sunlitFraction?: number;
  readonly provenance: readonly Provenance[];
  readonly disclaimer: string;
}

export interface OrbitAnswer extends OrbitDescription {
  readonly id: string;
  readonly date: string;
  readonly provenance: readonly Provenance[];
  readonly disclaimer: string;
}

export interface PassOptions {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly heightM?: number;
  readonly start?: Date | string;
  /** Length of the search (days, default 3). */
  readonly days?: number;
  /** Lowest culmination reported, and lowest elevation counted as visible (default 10 degrees). */
  readonly minElevationDeg?: number;
  /** IANA time zone for local times (e.g. America/Toronto). */
  readonly timeZone?: string;
  /** Language of the notes (default English). */
  readonly lang?: Lang;
}

/** Longest pass search (days): the elements' accuracy fades within days anyway. */
export const MAX_PASS_DAYS = 10;
/** Longest event search (days). */
export const MAX_EVENT_DAYS = 366;
/** Longest close-approach search (days): the elements' accuracy fades within days. */
export const MAX_APPROACH_DAYS = 7;
/** Longest sky-conjunction search (days). */
export const MAX_CONJUNCTION_DAYS = 31;
/** Longest shadow search (hours). */
export const MAX_SHADOW_HOURS = 48;
/** Satellites whose visible passes "tonight" lists: the ISS, Tiangong and Hubble. */
export const TONIGHT_SATELLITES = ['25544', '48274', '20580'] as const;

export interface PlaceOptions {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly heightM?: number;
  readonly timeZone?: string;
}

export { EVENT_KINDS, type EventKind };

function checkPlace(latDeg: number, lonDeg: number): void {
  if (!(Math.abs(latDeg) <= 90) || !(lonDeg >= -180 && lonDeg <= 360))
    throw new Error('latitude must be within 90 degrees of the equator and longitude within -180 to 360');
}

const SKY_PROVENANCE: Provenance = {
  model: 'vsop87',
  method:
    'astronomy-engine: VSOP87 planets, its lunar theory and IAU constellation boundaries, seen from the place with standard refraction; star positions from the catalogue (SIMBAD, J2000, proper motion ignored).',
  state: 'fresh',
  sources: [ASTRONOMY_ENGINE, SIMBAD],
  accuracy: {
    note: 'Positions of the Sun, the Moon and the planets to about an arcminute; rise, set and twilight times to within a minute (refraction near the horizon varies with the weather).',
  },
};

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
  /** A star's 3D map with the Sun (stars only), with another star compared with it. */
  readonly starMap?: boolean;
  readonly compare?: string;
}

/** Default reference point of a position: the body an object orbits or stands on. */
function defaultCentre(ref: ObjectRef): string {
  switch (ref.kind) {
    case 'satellite':
    case 'launch':
      return 'earth';
    case 'site':
      return ref.body === 'moon' ? 'moon:moon' : ref.body === 'titan' ? 'moon:titan' : ref.body;
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
      for (const s of await this.data.searchSatellites(query, limit + found.length)) {
        if (found.length >= limit) break;
        if (found.some((f) => f.id === String(s.norad))) continue;
        found.push({ id: String(s.norad), kind: 'satellite', name: { en: s.name, fr: s.name } });
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
              licence: LICENCES[image.licence].name,
              licenceUrl: LICENCES[image.licence].url,
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
          model3d: m.model3d,
          horizonsId: m.horizonsId,
          norad: m.norad,
          ephemeris: m.ephemeris,
          verified: m.verified,
          sources: m.sources,
        };
      }
      case 'satellite': {
        const [{ omm: o, entry }, sc] = await Promise.all([
          this.data.satelliteElements(ref.norad),
          this.data.satcatRecord(ref.norad),
        ]);
        const c = ref.curated;
        return {
          ...base,
          name: c?.name[lang] ?? o?.OBJECT_NAME ?? sc?.OBJECT_NAME,
          norad: ref.norad,
          cospar: o?.OBJECT_ID ?? sc?.OBJECT_ID,
          ...(c ? { agency: c.agency, country: c.country } : {}),
          owner: sc?.OWNER,
          launchDate: sc?.LAUNCH_DATE ?? c?.launchDate,
          launchSite: sc?.LAUNCH_SITE,
          objectType: sc?.OBJECT_TYPE,
          status: c?.status ?? sc?.OPS_STATUS_CODE,
          purpose: localized(c?.purpose),
          goals: localized(c?.goals),
          notes: localized(c?.notes),
          website: c?.website,
          model3d: c?.model3d,
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
      case 'comet': {
        const entry = (await this.data.manifest()).comets[ref.comet.id];
        return {
          ...base,
          name: ref.comet.name[lang],
          designation: ref.comet.designation,
          type: ref.comet.kind,
          ...(ref.comet.discovered ? { discovered: ref.comet.discovered } : {}),
          ...(ref.comet.nucleusKm ? { nucleusDiameterKm: ref.comet.nucleusKm } : {}),
          horizonsId: ref.comet.horizonsId,
          ...(entry?.m1 !== undefined && entry.k1 !== undefined
            ? {
                // m = M1 + 5 log Δ + 2.5 k1 log r (au): an estimate, comets often depart from it.
                magnitudeLaw: { m1: entry.m1, k1: entry.k1 },
              }
            : {}),
          notes: localized(ref.comet.notes),
          sources: ref.comet.sources,
        };
      }
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
    // An Earth satellite's own SGP4 state gives its ground point without a frame round trip.
    const ground = groundPoint(centreRef.id, rel, when, centreRef.id === 'earth' ? a.teme?.posKm : undefined);
    const lit =
      radius !== undefined && centreRef.kind !== 'sun'
        ? sunlight(a.state.posKm, c.state.posKm, radius)
        : undefined;
    return {
      ...answer,
      positionKm: rel,
      velocityKmS: vel,
      distanceKm,
      distanceAu: distanceKm / AU_KM,
      ...(radius !== undefined ? { altitudeKm: distanceKm - radius } : {}),
      speedKmS: length(vel),
      lightTimeS: distanceKm / LIGHT_SPEED_KM_S,
      ...(ground ? { groundPoint: ground } : {}),
      ...(lit !== undefined ? { sunlitFraction: round(lit, 3) } : {}),
    };
  }

  /**
   * Orbit of an object: mean SGP4 elements for an Earth satellite; otherwise the instantaneous two-body elements
   * around its centre (default: the body it orbits).
   */
  async orbit(id: string, date?: Date | string, centre?: string): Promise<OrbitAnswer> {
    const when = parseDate(date);
    const ref = resolve(id);
    if (ref.kind === 'satellite' && (centre === undefined || resolve(centre).id === 'earth')) {
      const h = await helioState(ref, when, this.data);
      if (!h.omm) throw new Error(`No published elements for ${ref.id}: ${h.provenance.method}`);
      return {
        id: ref.id,
        date: when.toISOString(),
        ...meanOrbit(h.omm),
        provenance: [h.provenance],
        disclaimer: DISCLAIMER,
      };
    }
    const s = await this.state(id, when, centre);
    const centreRef = resolve(s.centre);
    if (!s.positionKm || !s.velocityKmS)
      throw new Error(`No position for ${ref.id} at ${s.date} (${s.provenance[0]?.state ?? 'unknown'}).`);
    const o = osculatingOrbit(centreRef, s.positionKm, s.velocityKmS, when, radiusOf(centreRef));
    if (!o)
      throw new Error(
        `Orbits are given around the Sun, the planets and the Moon, not around ${centreRef.id}.`,
      );
    return { id: ref.id, date: s.date, ...o, provenance: s.provenance, disclaimer: DISCLAIMER };
  }

  /** Passes of an Earth satellite over a place: rise, culmination and set, and naked-eye visibility. */
  async passes(id: string, options: PassOptions, maxDays = MAX_PASS_DAYS): Promise<Record<string, unknown>> {
    const ref = resolve(id);
    if (ref.kind !== 'satellite')
      throw new Error('Passes are computed for Earth satellites (a NORAD number).');
    const { latDeg, lonDeg } = options;
    checkPlace(latDeg, lonDeg);
    const days = options.days ?? 3;
    if (!(days > 0 && days <= maxDays)) throw new Error(`days must be between 0 and ${maxDays}`);
    const minElevationDeg = options.minElevationDeg ?? 10;
    if (!(minElevationDeg >= 0 && minElevationDeg < 90))
      throw new Error('min_elevation must be between 0 and 90');
    const zone = options.timeZone;
    const local = zone ? localTime(zone) : undefined;
    const start = parseDate(options.start);
    const endMs = start.getTime() + days * 86_400_000;
    // Propagated here directly: no heliocentric position is needed.
    const h = await satelliteElementsAt(ref.norad, start, this.data);
    const satrec = h.satrec;
    if (!h.omm || !satrec) throw new Error(`No usable elements for ${ref.id}: ${h.provenance.method}`);
    const result = findPasses({
      satrec,
      observer: { latRad: radians(latDeg), lonRad: radians(lonDeg), heightKm: (options.heightM ?? 0) / 1000 },
      startMs: start.getTime(),
      endMs,
      minElevationRad: radians(minElevationDeg),
      limit: 60,
    });
    const point = (p: PassPoint): Record<string, unknown> => ({
      time: new Date(p.timeMs).toISOString(),
      ...(local ? { local: local(p.timeMs) } : {}),
      elevationDeg: degrees(p.elevationRad, 1),
      azimuthDeg: degrees(p.azimuthRad, 1),
      direction: compassPoint(p.azimuthRad),
      rangeKm: Math.round(p.rangeKm),
    });
    const epochMs = Date.parse(`${h.omm.EPOCH}Z`);
    return {
      id: ref.id,
      name: ref.curated?.name ?? { en: h.omm.OBJECT_NAME, fr: h.omm.OBJECT_NAME },
      observer: { latDeg, lonDeg, heightM: options.heightM ?? 0 },
      from: start.toISOString(),
      to: new Date(endMs).toISOString(),
      ...(zone ? { timeZone: zone } : {}),
      minElevationDeg,
      ...(result.alwaysAbove && result.atStart
        ? {
            alwaysAboveHorizon: {
              elevationDeg: degrees(result.atStart.elevationRad, 1),
              azimuthDeg: degrees(result.atStart.azimuthRad, 1),
              direction: compassPoint(result.atStart.azimuthRad),
            },
          }
        : {}),
      count: result.passes.length,
      passes: result.passes.map((p) => ({
        rise: point(p.rise),
        culmination: point(p.culmination),
        set: point(p.set),
        durationS: Math.round((p.set.timeMs - p.rise.timeMs) / 1000),
        ...(p.inProgress ? { inProgressAtStart: true } : {}),
        ...(p.unfinished ? { endsAfterWindow: true } : {}),
        visibleToNakedEye: p.visible !== undefined,
        ...(p.visible
          ? {
              visible: {
                from: new Date(p.visible.fromMs).toISOString(),
                to: new Date(p.visible.toMs).toISOString(),
                ...(local ? { localFrom: local(p.visible.fromMs), localTo: local(p.visible.toMs) } : {}),
                maxElevationDeg: degrees(p.visible.maxElevationRad, 1),
              },
            }
          : {}),
        sunElevationDeg: degrees(p.sunElevationRad, 1),
        sunlitShare: round(p.sunlitShare, 2),
      })),
      elementAgeDaysAtEnd: round((endMs - epochMs) / 86_400_000, 2),
      accuracy: NOTES.passes[options.lang ?? 'en'],
      provenance: [h.provenance],
      disclaimer: DISCLAIMER,
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

  /** The sky from a place at a date: Sun and twilights, the Moon and its phase, planets, bright named stars. */
  sky(
    place: PlaceOptions & { readonly date?: Date | string; readonly lang?: Lang },
  ): Record<string, unknown> {
    checkPlace(place.latDeg, place.lonDeg);
    const zone = place.timeZone;
    return {
      ...skyFrom({
        latDeg: place.latDeg,
        lonDeg: place.lonDeg,
        ...(place.heightM !== undefined ? { heightM: place.heightM } : {}),
        date: parseDate(place.date),
        lang: place.lang ?? 'en',
        ...(zone ? { local: localTime(zone) } : {}),
      }),
      ...(zone ? { timeZone: zone } : {}),
      provenance: [SKY_PROVENANCE],
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Astronomical events over a period (default: the next 30 days): Moon phases and distances, eclipses (also as
   * seen from a place, when given), equinoxes and solstices, perihelion and aphelion, planet oppositions,
   * conjunctions and elongations, and the missions' next key events.
   */
  events(
    options: {
      readonly start?: Date | string;
      readonly days?: number;
      readonly lang?: Lang;
      readonly kinds?: readonly EventKind[];
      readonly place?: PlaceOptions;
    } = {},
    maxDays = MAX_EVENT_DAYS,
  ): Record<string, unknown> {
    const start = parseDate(options.start);
    const days = options.days ?? 30;
    if (!(days > 0 && days <= maxDays)) throw new Error(`days must be between 0 and ${maxDays}`);
    const end = new Date(start.getTime() + days * 86_400_000);
    const place = options.place;
    if (place) checkPlace(place.latDeg, place.lonDeg);
    const zone = place?.timeZone;
    const events = eventsBetween({
      start,
      end,
      lang: options.lang ?? 'en',
      ...(options.kinds ? { kinds: options.kinds } : {}),
      ...(place
        ? {
            observer: {
              latDeg: place.latDeg,
              lonDeg: place.lonDeg,
              ...(place.heightM !== undefined ? { heightM: place.heightM } : {}),
            },
          }
        : {}),
      ...(zone ? { local: localTime(zone) } : {}),
    });
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      ...(place ? { place: { latDeg: place.latDeg, lonDeg: place.lonDeg } } : {}),
      ...(zone ? { timeZone: zone } : {}),
      count: events.length,
      events,
      notes: NOTES.events[options.lang ?? 'en'],
      provenance: [SKY_PROVENANCE],
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Counts of the active satellites: by owner (country or organisation), operator, CelesTrak group, orbit regime,
   * object type, launch year and low-orbit altitude band. `owner`, `operator` or `group` narrow the lists to the
   * entries whose code or name contains the text; otherwise the `limit` largest of each are given.
   */
  async stats(
    options: {
      readonly lang?: Lang;
      readonly owner?: string;
      readonly operator?: string;
      readonly group?: string;
      readonly limit?: number;
    } = {},
  ): Promise<Record<string, unknown>> {
    const published = await this.data.stats();
    if (!published) throw new Error('The satellite statistics are not published yet.');
    const { stats, entry } = published;
    const lang = options.lang ?? 'en';
    const limit = options.limit ?? 25;
    const fold = (s: string): string =>
      s
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
    type Row = (typeof stats.owners)[number];
    const pick = (rows: readonly Row[], filter: string | undefined) => {
      const q = filter ? fold(filter) : undefined;
      const kept = q
        ? rows.filter((r) => fold(r.id) === q || fold(r.name.en).includes(q) || fold(r.name.fr).includes(q))
        : rows.slice(0, limit);
      return {
        count: rows.length,
        ...(q ? {} : { shown: kept.length }),
        rows: kept.map((r) => ({
          id: r.id,
          name: r.name[lang],
          ...(r.country ? { country: r.country } : {}),
          total: r.total,
          regimes: r.regimes,
        })),
      };
    };
    return {
      asOf: stats.asOf,
      total: stats.total,
      regimes: stats.regimes,
      objectTypes: stats.objectTypes,
      owners: pick(stats.owners, options.owner),
      operators: { ...pick(stats.operators, options.operator), withoutOperator: stats.withoutOperator },
      groups: pick(stats.groups, options.group),
      launchYears: stats.launchYears,
      launchedLast30Days: stats.launchedLast30Days,
      launchedLast365Days: stats.launchedLast365Days,
      leoPerigeeBandsKm: stats.leoPerigeeBands,
      staleElements: stats.staleElements,
      supplementalElements: stats.supplementalElements,
      notes:
        'Active satellites as CelesTrak lists them (its "active" group: operational payloads, no debris or rocket bodies). Regimes: LEO apogee below 2000 km, GEO about one revolution a day, HEO eccentricity of 0.25 or more, MEO otherwise. Object types (SATCAT): PAY payload, R/B rocket body, DEB debris, UNK unknown. Owner codes: SATCAT (US, PRC for China, CIS for Russia, ESA…).',
      provenance: [
        {
          model: 'catalogue-counts',
          method:
            'Counted by Perigee’s pipeline from the published CelesTrak elements, SATCAT and group lists.',
          state: 'fresh',
          sources: [CELESTRAK],
          dataFetchedAt: entry.gpFetchedAt ?? stats.asOf,
          accuracy: ACCURACY['catalogue-counts'],
        } satisfies Provenance,
      ],
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Student-level definitions (EN/FR) of the terms shown in Perigee's panels, with the panel labels they explain;
   * all of them without a term. Matches the term id or a label, ignoring case and accents.
   */
  /**
   * Sunlight or shadow of an object at a date (in sunlight, in the penumbra or in the umbra of the body it
   * orbits, default the one it orbits), and its entries into and exits from the shadow over the next hours
   * (default: two orbits, at most `maxHours`).
   */
  async shadow(
    id: string,
    options: {
      readonly date?: Date | string;
      readonly hours?: number;
      readonly centre?: string;
      readonly timeZone?: string;
      readonly lang?: Lang;
    } = {},
    maxHours = MAX_SHADOW_HOURS,
  ): Promise<Record<string, unknown>> {
    const when = parseDate(options.date);
    const lang = options.lang ?? 'en';
    const ref = resolve(id);
    const centreRef = resolve(options.centre ?? defaultCentre(ref));
    const local = options.timeZone ? localTime(options.timeZone) : undefined;
    let fraction: (ms: number) => number | Promise<number>;
    let periodMin: number | undefined;
    let provenance: readonly Provenance[];
    if (ref.kind === 'satellite' && centreRef.id === 'earth') {
      // SGP4 and the low-precision Sun, both in TEME: no heliocentric round trip.
      const h = await satelliteElementsAt(ref.norad, when, this.data);
      const satrec = h.satrec;
      if (!h.omm || !satrec) throw new Error(`No usable elements for ${ref.id}: ${h.provenance.method}`);
      periodMin = meanOrbit(h.omm).periodMin;
      fraction = (ms) => {
        const date = new Date(ms);
        const teme = propagateTeme(satrec, date);
        return teme ? earthShadowFraction(teme.posKm, sunTeme(date), EARTH_EQUATORIAL_RADIUS_KM) : Number.NaN;
      };
      provenance = [h.provenance];
    } else {
      const radius = radiusOf(centreRef);
      if (radius === undefined)
        throw new Error(`Shadows are given for objects around a body, not around ${centreRef.id}.`);
      const first = await helioState(ref, when, this.data);
      provenance = [first.provenance];
      // The centre's heliocentric position on an hourly grid, linear in between (the Sun's direction from it
      // turns by a few arcseconds an hour): one astronomy-engine call an hour instead of one a sample.
      const grid = new Map<number, Vec3 | undefined>();
      const node = async (i: number): Promise<Vec3 | undefined> => {
        if (!grid.has(i))
          grid.set(i, (await helioState(centreRef, new Date(i * 3_600_000), this.data)).state?.posKm);
        return grid.get(i);
      };
      const centreAt = async (ms: number): Promise<Vec3 | undefined> => {
        const k = Math.floor(ms / 3_600_000);
        const [a, b] = [await node(k), await node(k + 1)];
        if (!a || !b) return undefined;
        const f = ms / 3_600_000 - k;
        return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
      };
      const entry =
        ref.kind === 'mission' ? (await this.data.manifest()).ephemerides[ref.mission.id] : undefined;
      if (
        ref.kind === 'mission' &&
        entry &&
        ref.mission.centralBody !== 'sun' &&
        centreRef.id === defaultCentre(ref)
      ) {
        // A lunar or Martian orbiter: its track around the centre, built once.
        const track = await missionTrack(ref.mission, entry, utcToTdbJd(when), this.data);
        fraction = async (ms) => {
          const rel = track.sample(utcToTdbJd(new Date(ms))).state;
          const c = await centreAt(ms);
          return rel && c ? sunlight(add(c, rel.posKm), c, radius) : Number.NaN;
        };
      } else {
        fraction = async (ms) => {
          const a = await helioState(ref, new Date(ms), this.data);
          const c = await centreAt(ms);
          return a.state && c ? sunlight(a.state.posKm, c, radius) : Number.NaN;
        };
      }
      const orbit = await this.orbit(id, when, centreRef.id).catch(() => undefined);
      periodMin = orbit?.periodMin;
    }
    const hours = options.hours ?? Math.min(maxHours, Math.max(1, ((periodMin ?? 720) * 2) / 60));
    if (!(hours > 0 && hours <= maxHours)) throw new Error(`hours must be between 0 and ${maxHours}`);
    const startMs = when.getTime();
    const endMs = startMs + hours * 3_600_000;
    // About 240 samples an orbit (a 90-minute orbit: every 22 s), between 5 s and 10 min.
    const stepMs = Math.min(600_000, Math.max(5_000, ((periodMin ?? 720) * 60_000) / 240));
    const now = await fraction(startMs);
    const changes = await lightChanges(fraction, startMs, endMs, stepMs);
    const stamp = (ms: number) => ({
      time: new Date(ms).toISOString(),
      ...(local ? { local: local(ms) } : {}),
    });
    const entry = changes.find((c) => c.from === 'sunlight');
    const exit = changes.find((c) => c.to === 'sunlight');
    return {
      id: ref.id,
      centre: centreRef.id,
      date: when.toISOString(),
      ...(Number.isNaN(now)
        ? {}
        : {
            light: lightOf(now),
            lightLabel: LIGHT_LABELS[lightOf(now)][lang],
            sunlitFraction: round(now, 3),
          }),
      window: {
        from: new Date(startMs).toISOString(),
        to: new Date(endMs).toISOString(),
        hours: round(hours, 2),
      },
      ...(periodMin !== undefined ? { orbitPeriodMin: round(periodMin, 1) } : {}),
      changes: changes.map((c) => ({
        ...stamp(c.timeMs),
        from: c.from,
        to: c.to,
        label: `${LIGHT_LABELS[c.from][lang]} → ${LIGHT_LABELS[c.to][lang]}`,
      })),
      ...(entry ? { nextShadowEntry: stamp(entry.timeMs) } : {}),
      ...(exit ? { nextShadowExit: stamp(exit.timeMs) } : {}),
      notes: NOTES.shadow[lang],
      provenance,
      disclaimer: DISCLAIMER,
    };
  }

  /** Ground track of an Earth satellite over one or two orbits: points (lat/lon/height) and a GeoJSON line. */
  async groundTrack(
    id: string,
    options: {
      readonly start?: Date | string;
      readonly orbits?: number;
      readonly points?: number;
      readonly lang?: Lang;
    } = {},
  ): Promise<Record<string, unknown>> {
    const lang = options.lang ?? 'en';
    const ref = resolve(id);
    if (ref.kind !== 'satellite')
      throw new Error('Ground tracks are computed for Earth satellites (a NORAD number).');
    const start = parseDate(options.start);
    const orbits = options.orbits ?? 1;
    if (!(orbits > 0 && orbits <= 2)) throw new Error('orbits must be between 0 and 2');
    const h = await satelliteElementsAt(ref.norad, start, this.data);
    if (!h.omm || !h.satrec) throw new Error(`No usable elements for ${ref.id}: ${h.provenance.method}`);
    const orbit = meanOrbit(h.omm);
    const periodMin = orbit.periodMin ?? 90;
    const count = Math.max(10, Math.min(360, Math.round(options.points ?? 180 * orbits)));
    const endMs = start.getTime() + orbits * periodMin * 60_000;
    const points = groundTrackPoints(h.satrec, start.getTime(), endMs, count);
    const ends = [points[0], points[points.length - 1]].map((p) =>
      p
        ? groundPoint(
            'earth',
            [0, 0, 0],
            new Date(p.time),
            propagateTeme(h.satrec as NonNullable<typeof h.satrec>, new Date(p.time))?.posKm,
          )
        : undefined,
    );
    return {
      id: ref.id,
      name: ref.curated?.name ?? { en: h.omm.OBJECT_NAME, fr: h.omm.OBJECT_NAME },
      from: start.toISOString(),
      to: new Date(endMs).toISOString(),
      orbits,
      periodMin: round(periodMin, 1),
      inclinationDeg: orbit.inclinationDeg,
      count: points.length,
      points,
      geojson: trackGeoJson(points),
      ...(ends[0]?.over ? { startsOver: ends[0].over } : {}),
      ...(ends[1]?.over ? { endsOver: ends[1].over } : {}),
      notes: NOTES.groundTrack[lang],
      provenance: [h.provenance],
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Closest approaches between two objects in space over a window (default: 1 day from the date, at most
   * `maxDays`): the deepest minima of their distance, timed to 20 ms, with the relative speed for two Earth
   * satellites. For education only, never for collision avoidance.
   */
  async closeApproach(
    aId: string,
    bId: string,
    options: {
      readonly start?: Date | string;
      readonly days?: number;
      readonly timeZone?: string;
      readonly lang?: Lang;
    } = {},
    maxDays = MAX_APPROACH_DAYS,
  ): Promise<Record<string, unknown>> {
    const lang = options.lang ?? 'en';
    const [a, b] = [resolve(aId), resolve(bId)];
    if (a.id === b.id) throw new Error('Give two different objects.');
    const start = parseDate(options.start);
    const days = options.days ?? 1;
    if (!(days > 0 && days <= maxDays)) throw new Error(`days must be between 0 and ${maxDays}`);
    const startMs = start.getTime();
    const endMs = startMs + days * 86_400_000;
    const local = options.timeZone ? localTime(options.timeZone) : undefined;
    let distanceKm: (ms: number) => number | Promise<number>;
    let speed: ((ms: number) => number | undefined) | undefined;
    let provenance: readonly Provenance[];
    let search: { maxRelativeSpeedKmS: number; minStepMs: number; maxStepMs: number };
    if (a.kind === 'satellite' && b.kind === 'satellite') {
      const [ha, hb] = await Promise.all([
        satelliteElementsAt(a.norad, start, this.data),
        satelliteElementsAt(b.norad, start, this.data),
      ]);
      const [sa, sb] = [ha.satrec, hb.satrec];
      if (!sa || !sb) throw new Error(`No usable elements for ${!sa ? a.id : b.id}.`);
      const pair = (ms: number) => {
        const date = new Date(ms);
        const pa = propagateTeme(sa, date);
        const pb = propagateTeme(sb, date);
        return pa && pb ? { pa, pb } : undefined;
      };
      distanceKm = (ms) => {
        const p = pair(ms);
        return p ? length(sub(p.pa.posKm, p.pb.posKm)) : Number.NaN;
      };
      speed = (ms) => {
        const p = pair(ms);
        return p ? length(sub(p.pa.velKmS, p.pb.velKmS)) : undefined;
      };
      provenance = [ha.provenance, hb.provenance];
      // Two Earth orbiters close in at most ~16 km/s (head-on in low orbit).
      search = { maxRelativeSpeedKmS: 16, minStepMs: 1_000, maxStepMs: 600_000 };
    } else {
      const states = async (ms: number) => {
        const date = new Date(ms);
        return Promise.all([helioState(a, date, this.data), helioState(b, date, this.data)]);
      };
      const [first] = [await states(startMs)];
      provenance = [first[0].provenance, first[1].provenance];
      distanceKm = async (ms) => {
        const [x, y] = await states(ms);
        return x.state && y.state ? length(sub(x.state.posKm, y.state.posKm)) : Number.NaN;
      };
      // Any pair: about 600 samples over the window, then golden-section search.
      const span = endMs - startMs;
      search = { maxRelativeSpeedKmS: 1e9, minStepMs: span / 600, maxStepMs: span / 600 };
    }
    const minima = await closestApproaches({ distanceKm, startMs, endMs, limit: 5, ...search });
    const describe = (m: { timeMs: number; distanceKm: number }) => {
      const v = speed?.(m.timeMs);
      return {
        time: new Date(m.timeMs).toISOString(),
        ...(local ? { local: local(m.timeMs) } : {}),
        distanceKm: round(m.distanceKm, 3),
        ...(v !== undefined ? { relativeSpeedKmS: round(v, 3) } : {}),
      };
    };
    const closest = minima[0];
    return {
      from: a.id,
      to: b.id,
      window: { from: start.toISOString(), to: new Date(endMs).toISOString(), days },
      ...(closest ? { closest: describe(closest) } : {}),
      approaches: minima.map(describe),
      warning: NOTES.approachWarning[lang],
      provenance,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Apparent close pairings seen from a place over a period (default 7 days, at most `maxDays`): the Moon and the
   * planets with each other and with the bright stars near the ecliptic; with `satellite`, that satellite passing
   * near them during its passes (within 1 day).
   */
  async skyConjunctions(
    place: PlaceOptions & {
      readonly start?: Date | string;
      readonly days?: number;
      readonly maxSeparationDeg?: number;
      readonly satellite?: string;
      readonly lang?: Lang;
    },
    maxDays = MAX_CONJUNCTION_DAYS,
  ): Promise<Record<string, unknown>> {
    checkPlace(place.latDeg, place.lonDeg);
    const start = parseDate(place.start);
    const days = place.days ?? (place.satellite ? 1 : 7);
    const limit = place.satellite ? Math.min(1, maxDays) : maxDays;
    if (!(days > 0 && days <= limit)) throw new Error(`days must be between 0 and ${limit}`);
    const maxSeparationDeg = place.maxSeparationDeg ?? 5;
    if (!(maxSeparationDeg > 0 && maxSeparationDeg <= 10))
      throw new Error('max_separation must be between 0 and 10 degrees');
    const zone = place.timeZone;
    const lang = place.lang ?? 'en';
    const provenance: Provenance[] = [SKY_PROVENANCE];
    let satellite: Parameters<typeof skyConjunctions>[0]['satellite'];
    if (place.satellite) {
      const ref = resolve(place.satellite);
      if (ref.kind !== 'satellite') throw new Error('satellite must be an Earth satellite (a NORAD number).');
      const h = await satelliteElementsAt(ref.norad, start, this.data);
      if (!h.omm || !h.satrec) throw new Error(`No usable elements for ${ref.id}: ${h.provenance.method}`);
      satellite = {
        id: ref.id,
        name: ref.curated?.name ?? { en: h.omm.OBJECT_NAME, fr: h.omm.OBJECT_NAME },
        satrec: h.satrec,
      };
      provenance.push(h.provenance);
    }
    const found = skyConjunctions({
      latDeg: place.latDeg,
      lonDeg: place.lonDeg,
      ...(place.heightM !== undefined ? { heightM: place.heightM } : {}),
      startMs: start.getTime(),
      endMs: start.getTime() + days * 86_400_000,
      maxSeparationDeg,
      lang,
      ...(zone ? { local: localTime(zone) } : {}),
      ...(satellite ? { satellite } : {}),
    });
    return {
      place: { latDeg: place.latDeg, lonDeg: place.lonDeg },
      from: start.toISOString(),
      to: new Date(start.getTime() + days * 86_400_000).toISOString(),
      ...(zone ? { timeZone: zone } : {}),
      maxSeparationDeg,
      count: found.length,
      conjunctions: found,
      notes: NOTES.conjunctions[lang],
      provenance,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * What to see tonight from a place: the coming night (dusk to dawn, civil twilight), the Moon, the planets
   * visible to the naked eye, the visible passes of the ISS, Tiangong and Hubble, the conjunctions and the
   * astronomical events of the night, with short highlights.
   */
  async tonight(
    place: PlaceOptions & { readonly date?: Date | string; readonly lang?: Lang },
  ): Promise<Record<string, unknown>> {
    checkPlace(place.latDeg, place.lonDeg);
    const lang = place.lang ?? 'en';
    const fr = lang === 'fr';
    const zone = place.timeZone;
    const local = zone ? localTime(zone) : undefined;
    const when = parseDate(place.date);
    const observer = new Astronomy.Observer(place.latDeg, place.lonDeg, place.heightM ?? 0);
    const t0 = Astronomy.MakeTime(when);
    const sunEq = Astronomy.Equator(Astronomy.Body.Sun, t0, observer, true, true);
    const sunAlt = Astronomy.Horizon(t0, observer, sunEq.ra, sunEq.dec, 'normal').altitude;
    const dusk = sunAlt <= -6 ? t0 : Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, -1, t0, 1.5, -6);
    const dawn = dusk ? Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, +1, dusk, 1.5, -6) : null;
    const stamp = (ms: number) => ({
      time: new Date(ms).toISOString(),
      ...(local ? { local: local(ms) } : {}),
    });
    if (!dusk || !dawn) {
      return {
        place: { latDeg: place.latDeg, lonDeg: place.lonDeg },
        date: when.toISOString(),
        night: null,
        highlights: [
          fr
            ? 'Pas de nuit noire dans les prochaines 36 heures (le Soleil ne descend pas à 6° sous l’horizon).'
            : 'No dark night in the next 36 hours (the Sun does not go 6 degrees below the horizon).',
        ],
        provenance: [SKY_PROVENANCE],
        disclaimer: DISCLAIMER,
      };
    }
    const fromMs = dusk.date.getTime();
    const toMs = dawn.date.getTime();
    // The sky an hour into the night (or now, when it is already night).
    const lookMs = Math.min(toMs, Math.max(when.getTime(), fromMs + 3_600_000));
    const sky = skyFrom({
      latDeg: place.latDeg,
      lonDeg: place.lonDeg,
      ...(place.heightM !== undefined ? { heightM: place.heightM } : {}),
      date: new Date(lookMs),
      lang,
      ...(local ? { local } : {}),
    }) as {
      moon: Record<string, unknown> & { phase: string; illuminatedPercent: number; aboveHorizon: boolean };
      planets: (Record<string, unknown> & {
        name: string;
        nakedEyeNow: boolean;
        direction: string;
        altitudeDeg: number;
      })[];
    };
    const planets = sky.planets.filter((p) => p.nakedEyeNow);
    const passes: Record<string, unknown>[] = [];
    const provenance: Provenance[] = [SKY_PROVENANCE];
    for (const id of TONIGHT_SATELLITES) {
      const ref = resolve(id);
      if (ref.kind !== 'satellite') continue;
      const h = await satelliteElementsAt(ref.norad, new Date(fromMs), this.data).catch(() => undefined);
      if (!h?.omm || !h.satrec) continue;
      const found = findPasses({
        satrec: h.satrec,
        observer: {
          latRad: radians(place.latDeg),
          lonRad: radians(place.lonDeg),
          heightKm: (place.heightM ?? 0) / 1000,
        },
        startMs: fromMs,
        endMs: toMs,
        minElevationRad: radians(10),
        limit: 10,
      });
      const name = ref.curated?.name[lang] ?? h.omm.OBJECT_NAME;
      for (const p of found.passes) {
        if (!p.visible) continue;
        passes.push({
          id: ref.id,
          name,
          from: stamp(p.visible.fromMs),
          to: stamp(p.visible.toMs),
          maxElevationDeg: degrees(p.visible.maxElevationRad, 1),
          rise: compassPoint(p.rise.azimuthRad),
          set: compassPoint(p.set.azimuthRad),
        });
      }
      provenance.push(h.provenance);
    }
    passes.sort((x, y) =>
      String((x['from'] as { time: string }).time).localeCompare(
        String((y['from'] as { time: string }).time),
      ),
    );
    const conjunctions = skyConjunctions({
      latDeg: place.latDeg,
      lonDeg: place.lonDeg,
      ...(place.heightM !== undefined ? { heightM: place.heightM } : {}),
      startMs: fromMs,
      endMs: toMs,
      maxSeparationDeg: 5,
      lang,
      ...(local ? { local } : {}),
    }).filter((c) => c['visibleFromPlace']);
    // The sky's events only: the missions' milestones are dated to the day at best, not to a night.
    const events = eventsBetween({
      start: new Date(fromMs),
      end: new Date(toMs),
      lang,
      kinds: ['moon', 'eclipse', 'season', 'planet'],
      observer: {
        latDeg: place.latDeg,
        lonDeg: place.lonDeg,
        ...(place.heightM !== undefined ? { heightM: place.heightM } : {}),
      },
      ...(local ? { local } : {}),
    });
    const at = (ms: number): string => local?.(ms) ?? new Date(ms).toISOString().slice(11, 16) + ' UTC';
    const num = (n: unknown): string => (fr ? String(n).replace('.', ',') : String(n));
    const highlights: string[] = [];
    highlights.push(fr ? `Nuit de ${at(fromMs)} à ${at(toMs)}.` : `Night from ${at(fromMs)} to ${at(toMs)}.`);
    highlights.push(
      fr
        ? `Lune : ${sky.moon.phase}, éclairée à ${sky.moon.illuminatedPercent} %${sky.moon.aboveHorizon ? '' : ' (sous l’horizon en début de nuit)'}.`
        : `Moon: ${sky.moon.phase}, ${sky.moon.illuminatedPercent}% lit${sky.moon.aboveHorizon ? '' : ' (below the horizon early in the night)'}.`,
    );
    if (planets.length)
      highlights.push(
        (fr ? 'Planètes à l’œil nu : ' : 'Planets to the naked eye: ') +
          planets
            .map((p) => `${p.name} (${compassLabel(p.direction, lang)}, ${Math.round(p.altitudeDeg)}°)`)
            .join(', ') +
          '.',
      );
    for (const p of passes) {
      const from = p['from'] as { time: string; local?: string };
      highlights.push(
        fr
          ? `${String(p['name'])} visible à ${from.local ?? from.time.slice(11, 16)}, jusqu’à ${num(p['maxElevationDeg'])}° de hauteur (${compassLabel(String(p['rise']), lang)} → ${compassLabel(String(p['set']), lang)}).`
          : `${String(p['name'])} visible at ${from.local ?? from.time.slice(11, 16)}, up to ${num(p['maxElevationDeg'])}° high (${compassLabel(String(p['rise']), lang)} → ${compassLabel(String(p['set']), lang)}).`,
      );
    }
    for (const c of conjunctions) {
      const objects = c['objects'] as { name: string }[];
      highlights.push(
        fr
          ? `${objects.map((x) => x.name).join(' et ')} à ${num(c['separationDeg'])}° l’un de l’autre (${compassLabel(String(c['direction']), lang)}).`
          : `${objects.map((x) => x.name).join(' and ')} ${String(c['separationDeg'])}° apart (${compassLabel(String(c['direction']), lang)}).`,
      );
    }
    for (const e of events) highlights.push(e.title);
    return {
      place: { latDeg: place.latDeg, lonDeg: place.lonDeg },
      ...(zone ? { timeZone: zone } : {}),
      night: { from: stamp(fromMs), to: stamp(toMs), skyAt: stamp(lookMs) },
      moon: sky.moon,
      planets,
      passes,
      conjunctions,
      events,
      highlights,
      notes: NOTES.tonight[lang],
      provenance,
      disclaimer: DISCLAIMER,
    };
  }

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

  /**
   * A Perigee link or embed URL in words (alternative text and a description for lesson notes): view, selected
   * object and how reliable its position is, date and speed of time, frame, filters, what is hidden.
   */
  describeView(link: string, lang: Lang = 'en', timeZone?: string): Promise<Record<string, unknown>> {
    if (timeZone) new Intl.DateTimeFormat('en', { timeZone }); // throws on an unknown zone
    return describeView(this, link, lang, timeZone).then((r) => ({ ...r, disclaimer: DISCLAIMER }));
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
    if (options.starMap) {
      if (!sel.startsWith('star:')) throw new Error(`The star map needs a star (star:<id>), not ${id}`);
      p.set('map', '1');
      if (options.compare) {
        const other = viewOf(resolve(options.compare)).sel;
        if (!other.startsWith('star:'))
          throw new Error(`Only a star can be compared on the map, not ${options.compare}`);
        p.set('pick', other);
      }
    } else if (options.follow) p.set('follow', '1');
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
        landingSites: sitesByBody().reduce((n, [, sites]) => n + sites.length, 0),
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
